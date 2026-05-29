import { NextResponse } from 'next/server';
import { getDiagnostics } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['warning', 'error', 'critical']);

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  const sev = url.searchParams.get('severity') || undefined;
  if (sev && !VALID_SEVERITIES.has(sev)) {
    return NextResponse.json({ error: 'invalid_severity' }, { status: 400 });
  }
  const taskId = url.searchParams.get('task') || undefined;
  if (taskId && !TASK_ID_RE.test(taskId)) {
    return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  }
  try {
    const diagnostics = await getDiagnostics(board, { severity: sev, taskId });
    return NextResponse.json(
      { diagnostics },
      { headers: { 'Cache-Control': 'private, max-age=4, stale-while-revalidate=12' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'kanban_diag_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
