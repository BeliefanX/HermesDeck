import { NextResponse } from 'next/server';
import {
  getTaskDetail,
  applyTaskAction,
  assignTask,
  commentTask,
  linkTasks,
  unlinkTasks,
  editTask,
  type TaskAction,
} from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJson, requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_ACTIONS: ReadonlySet<TaskAction> = new Set(['block', 'unblock', 'complete', 'archive', 'reclaim']);

interface RouteCtx {
  // Next 16 routes use Promise-shaped params; older versions delivered them sync.
  params: Promise<{ id: string }>;
}

async function resolveParams(ctx: RouteCtx): Promise<{ id: string } | null> {
  try {
    const p = await ctx.params;
    return p && typeof p.id === 'string' && TASK_ID_RE.test(p.id) ? { id: p.id } : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, ctx: RouteCtx) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const params = await resolveParams(ctx);
  if (!params) return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  try {
    const detail = await getTaskDetail(board, params.id);
    if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'private, max-age=1' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'task_detail_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const params = await resolveParams(ctx);
  if (!params) return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) return NextResponse.json({ error: 'invalid_board' }, { status: 400 });

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 256_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson(req, 256_000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const op = (body as { op?: unknown })?.op;
  try {
    if (typeof op !== 'string') {
      return NextResponse.json({ error: 'op_required' }, { status: 400 });
    }
    if (op === 'comment') {
      const text = (body as { body?: unknown })?.body;
      const author = (body as { author?: unknown })?.author;
      if (typeof text !== 'string' || !text.trim()) {
        return NextResponse.json({ error: 'comment_body_required' }, { status: 400 });
      }
      await commentTask(board, params.id, text, typeof author === 'string' ? author : undefined);
      return NextResponse.json({ ok: true });
    }
    if (op === 'assign') {
      const profile = (body as { profile?: unknown })?.profile;
      if (profile !== null && typeof profile !== 'string') {
        return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
      }
      await assignTask(board, params.id, profile === null ? null : profile);
      return NextResponse.json({ ok: true });
    }
    if (VALID_ACTIONS.has(op as TaskAction)) {
      const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason : undefined;
      const summary = typeof (body as { summary?: unknown })?.summary === 'string' ? (body as { summary: string }).summary : undefined;
      await applyTaskAction(board, params.id, op as TaskAction, { reason, summary });
      return NextResponse.json({ ok: true });
    }
    if (op === 'link' || op === 'unlink') {
      // The current task is the parent; child id is supplied in the body. We
      // expose only this direction to keep the UI simple — the inverse is just
      // calling the same op from the other task.
      const child = (body as { childId?: unknown })?.childId;
      if (typeof child !== 'string' || !child.trim()) {
        return NextResponse.json({ error: 'child_id_required' }, { status: 400 });
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(child)) {
        return NextResponse.json({ error: 'invalid_child_id' }, { status: 400 });
      }
      if (op === 'link') await linkTasks(board, params.id, child);
      else await unlinkTasks(board, params.id, child);
      return NextResponse.json({ ok: true });
    }
    if (op === 'edit') {
      const result = (body as { result?: unknown })?.result;
      const summary = (body as { summary?: unknown })?.summary;
      const metadata = (body as { metadata?: unknown })?.metadata;
      if (typeof result !== 'string' || !result.trim()) {
        return NextResponse.json({ error: 'result_required' }, { status: 400 });
      }
      await editTask(board, params.id, {
        result,
        summary: typeof summary === 'string' ? summary : undefined,
        metadata: metadata ?? undefined,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'unknown_op' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'kanban_op_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
