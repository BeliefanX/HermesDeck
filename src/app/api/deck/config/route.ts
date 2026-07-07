import { NextRequest, NextResponse } from 'next/server';
import { readProfileConfig, saveProfileConfigFile } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJsonText } from '@/lib/server/csrf';
import type { ConfigFileKey } from '@/lib/config-files';
import { requireSuperAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1024 * 1024; // 1MB — well above any real config file.

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function statusForError(err: unknown): number {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case 'INVALID_PROFILE':
    case 'INVALID_CONTENT':
    case 'PATH_ESCAPES_BASE':
      return 400;
    case 'CONTENT_TOO_LARGE':
      return 413;
    case 'YAML_INVALID':
      return 422;
    case 'MTIME_MISMATCH':
      return 409;
    default:
      break;
  }
  if (/^unknown_config_file/.test(e?.message || '')) return 400;
  return 500;
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const profile = new URL(req.url).searchParams.get('profile') || 'default';
  try {
    const bundle = await readProfileConfig(profile);
    return NextResponse.json(bundle, {
      headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=10' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'config_read_failed', detail: msg.slice(0, 200) },
      { status: statusForError(err) },
    );
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

  const profile = new URL(req.url).searchParams.get('profile') || 'default';
  const b = body as { file?: unknown; content?: unknown; mtime?: unknown };

  try {
    const result = await saveProfileConfigFile({
      profileId: profile,
      fileKey: b.file as ConfigFileKey,
      content: b.content,
      mtime: typeof b.mtime === 'string' && b.mtime ? b.mtime : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { code?: string; detail?: string; line?: number; col?: number };
    if (e.code === 'YAML_INVALID') {
      return NextResponse.json(
        { error: 'yaml_invalid', detail: e.detail || 'invalid YAML', line: e.line, col: e.col },
        { status: 422 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'config_write_failed', detail: msg.slice(0, 200) },
      { status: statusForError(err) },
    );
  }
}
