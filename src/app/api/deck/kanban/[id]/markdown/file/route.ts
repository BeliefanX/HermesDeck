import { NextResponse } from 'next/server';
import { readMarkdownFile, writeMarkdownFile } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJson, requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Path may contain forward slashes (subdirs) and dots; cap length to keep
// queries reasonable. Backslash / NUL get rejected by the server-side
// validator anyway, so the regex stays loose here.
const REL_PATH_RE = /^[^\\\0]{1,1024}$/;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function classifyError(msg: string): { status: number; code: string } {
  if (/no_workspace/i.test(msg)) return { status: 404, code: 'no_workspace' };
  if (/mtime_conflict/i.test(msg)) return { status: 409, code: 'mtime_conflict' };
  if (/file_not_found/i.test(msg) || /ENOENT/i.test(msg)) return { status: 404, code: 'file_not_found' };
  if (/path_outside_workspace|invalid_path/i.test(msg)) return { status: 400, code: 'invalid_path' };
  if (/not_markdown/i.test(msg)) return { status: 400, code: 'not_markdown' };
  if (/file_too_large/i.test(msg)) return { status: 413, code: 'file_too_large' };
  if (/not_a_file/i.test(msg)) return { status: 400, code: 'not_a_file' };
  return { status: 502, code: 'kanban_markdown_failed' };
}

export async function GET(req: Request, ctx: RouteCtx) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const params = await ctx.params;
  if (!params || !TASK_ID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  }
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  const relPath = url.searchParams.get('path') || '';
  if (!BOARD_SLUG_RE.test(board)) return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  if (!REL_PATH_RE.test(relPath)) return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  try {
    const r = await readMarkdownFile(board, params.id, relPath);
    return NextResponse.json(r, { headers: { 'Cache-Control': 'private, max-age=2' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { status, code } = classifyError(msg);
    return NextResponse.json({ error: code, detail: msg.slice(0, 240) }, { status });
  }
}

export async function PUT(req: Request, ctx: RouteCtx) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 2_100_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const params = await ctx.params;
  if (!params || !TASK_ID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  }
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) return NextResponse.json({ error: 'invalid_board' }, { status: 400 });

  const parsed = await readLimitedJson(req, 2_100_000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const relPath = (body as { path?: unknown })?.path;
  const content = (body as { content?: unknown })?.content;
  const mtimeRaw = (body as { mtime?: unknown })?.mtime;
  if (typeof relPath !== 'string' || !REL_PATH_RE.test(relPath)) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content_required' }, { status: 400 });
  }
  // Optional optimistic-lock token (epoch seconds) from the prior read. A
  // non-numeric value is ignored rather than rejected, so older clients that
  // don't send it keep working.
  const mtime = typeof mtimeRaw === 'number' && Number.isFinite(mtimeRaw) ? mtimeRaw : undefined;
  try {
    const r = await writeMarkdownFile(board, params.id, relPath, content, mtime);
    return NextResponse.json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { status, code } = classifyError(msg);
    return NextResponse.json({ error: code, detail: msg.slice(0, 240) }, { status });
  }
}
