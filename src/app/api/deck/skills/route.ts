import { NextRequest, NextResponse } from 'next/server';
import { readSkill, saveSkill } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJsonText } from '@/lib/server/csrf';
import { requireSuperAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB — well above any real SKILL.md

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function statusForFsError(err: unknown): number {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'ENOENT') return 404;
  if (e?.message === 'invalid_path' || e?.message === 'path_escapes_base') return 400;
  if (e?.code === 'MTIME_MISMATCH' || e?.message === 'mtime_mismatch') return 409;
  return 500;
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const relPath = url.searchParams.get('path') || '';
  if (!relPath) return badRequest('missing_path');
  try {
    const skill = await readSkill(relPath);
    return NextResponse.json(skill, {
      headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=10' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'skill_read_failed', detail: msg.slice(0, 200) }, { status: statusForFsError(err) });
  }
}

export async function PUT(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_BODY_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const limitedBody = await readLimitedJsonText(req, MAX_BODY_BYTES);
  if (!limitedBody.ok) return limitedBody.response;
  let body: unknown;
  try { body = limitedBody.text ? JSON.parse(limitedBody.text) : {}; }
  catch { return badRequest('invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('invalid_body');

  try {
    const result = await saveSkill(body as { relPath: unknown; content: unknown; mtime?: unknown });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'skill_write_failed', detail: msg.slice(0, 200) }, { status: statusForFsError(err) });
  }
}
