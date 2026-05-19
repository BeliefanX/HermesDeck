import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/server/terminal-pty';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller closed */ }
      };

      let sub: ReturnType<typeof subscribe>;
      try {
        sub = subscribe(id, {
          send,
          close: () => { try { controller.close(); } catch {} },
        });
      } catch (e) {
        send('error', { error: e instanceof Error ? e.message : String(e) });
        try { controller.close(); } catch {}
        return;
      }

      send('ready', { cols: sub.cols, rows: sub.rows });
      for (const chunk of sub.replay) send('data', chunk);
      send('replay-end', { count: sub.replay.length });

      unsubscribe = sub.unsubscribe;
      keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ka\n\n`)); } catch {}
      }, 25_000);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
