import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { assertSessionBelongsToProfile, SessionProfileRoutingError } from '@/lib/server/hermes';
import { hermesApiRequest } from '@/lib/server/hermes/core';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 4096 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<Record<string, unknown>>(req, 4096, {});
  if (!parsed.ok) return parsed.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sessionId = decodeURIComponent(id);
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile') ?? parsed.value.profile, 'default');
  if (!profile) return rbacJsonError(400, 'invalid_profile', 'Invalid profile.');
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    await assertSessionBelongsToProfile(sessionId, profile);
    const body = { ...parsed.value };
    delete body.profile;
    const result = await hermesApiRequest<unknown>('POST', `/api/sessions/${encodeURIComponent(sessionId)}/fork?profile=${encodeURIComponent(profile)}`, body, 10_000, profile);
    return NextResponse.json({ ok: true, profileId: profile, result }, { status: 201 });
  } catch (err) {
    if (err instanceof SessionProfileRoutingError) {
      return NextResponse.json({ ok: false, error: err.code, detail: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'session_fork_failed', detail: msg.slice(0, 200) }, { status: 502 });
  }
}
