import { NextRequest, NextResponse } from 'next/server';
import { assertSessionBelongsToProfile, deleteSession, SessionProfileRoutingError } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { hermesApiRequest } from '@/lib/server/hermes/core';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 4096 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 4096);
  if (!parsed.ok) return parsed.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sessionId = decodeURIComponent(id);
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile') ?? parsed.value.profile, 'default');
  if (!profile) return rbacJsonError(400, 'invalid_profile', 'Invalid profile.');
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  const body: Record<string, unknown> = {};
  if ('title' in parsed.value) body.title = typeof parsed.value.title === 'string' || parsed.value.title === null ? parsed.value.title : String(parsed.value.title);
  if ('end_reason' in parsed.value) body.end_reason = parsed.value.end_reason;
  if (!Object.keys(body).length) return rbacJsonError(400, 'invalid_session_patch', 'No supported session fields.');
  try {
    await assertSessionBelongsToProfile(sessionId, profile);
    const result = await hermesApiRequest<unknown>('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profile)}`, body, 10_000, profile);
    return NextResponse.json({ ok: true, profileId: profile, result });
  } catch (err) {
    if (err instanceof SessionProfileRoutingError) {
      return NextResponse.json({ ok: false, error: err.code, detail: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'session_patch_failed', detail: msg.slice(0, 200) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ ok: false, removed: 0, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const result = await deleteSession(decodeURIComponent(id), profile);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, removed: 0, error: 'session_delete_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
