import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/server/terminal-pty';
import { requireSuperAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        unsubscribe?.();
        unsubscribe = null;
        try { controller.close(); } catch {}
      };
      const enqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
      };
      const send = (event: string, data: unknown) => {
        enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let sub: Awaited<ReturnType<typeof subscribe>>;
      try {
        sub = await subscribe(id, {
          send,
          close: cleanup,
        });
        unsubscribe = sub.unsubscribe;
      } catch (e) {
        send('error', { error: e instanceof Error ? e.message : String(e) });
        cleanup();
        return;
      }

      send('ready', { cols: sub.cols, rows: sub.rows });
      for (const chunk of sub.replay) send('data', chunk);
      send('replay-end', { count: sub.replay.length });

      keepalive = setInterval(() => {
        enqueue(`: ka\n\n`);
      }, 25_000);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      if (unsubscribe) unsubscribe();
      keepalive = null;
      unsubscribe = null;
      closed = true;
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
