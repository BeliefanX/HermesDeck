import { NextResponse } from 'next/server';
import { getBoardSnapshot, createTask, type CreateTaskInput } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJson, requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  try {
    const snapshot = await getBoardSnapshot(board);
    return NextResponse.json(
      snapshot,
      { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=8' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'kanban_snapshot_failed', detail: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 256_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<Partial<CreateTaskInput>>(req, 256_000, {});
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;
  if (typeof b.title !== 'string' || !b.title.trim()) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }
  try {
    const result = await createTask(board, {
      title: b.title,
      body: typeof b.body === 'string' ? b.body : undefined,
      assignee: typeof b.assignee === 'string' ? b.assignee : undefined,
      priority: typeof b.priority === 'number' ? b.priority : undefined,
      workspaceKind: b.workspaceKind === 'worktree' || b.workspaceKind === 'session' ? b.workspaceKind : 'scratch',
      workspacePath: typeof b.workspacePath === 'string' ? b.workspacePath : undefined,
      tenant: typeof b.tenant === 'string' ? b.tenant : undefined,
      parents: Array.isArray(b.parents) ? b.parents.filter((p): p is string => typeof p === 'string') : undefined,
      skills: Array.isArray(b.skills) ? b.skills.filter((s): s is string => typeof s === 'string') : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'kanban_create_failed', detail: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}
