import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { CronProfileRoutingError, getCronJobs, getStrictProfiles } from '@/lib/server/hermes';
import { upstreamJson } from '@/lib/server/hermes/deck-agent-api';
import { PROFILE_ID_RE, filterProfilesForUser, isAdminRole, profileScopeForUser, rbacJsonError, requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const profile = url.searchParams.get('profile') || undefined;
  if (profile && !PROFILE_ID_RE.test(profile)) {
    return NextResponse.json({ jobs: [], error: 'invalid_profile' }, { status: 400 });
  }
  const scope = profileScopeForUser(auth.user, profile);
  if (!scope.ok) return scope.response;
  try {
    let profileIds: string[] = scope.profiles ?? [];
    if (!profileIds.length) {
      const profiles = filterProfilesForUser(auth.user, await getStrictProfiles());
      profileIds = profiles.map((item) => item.id).filter((id) => PROFILE_ID_RE.test(id));
    }
    const jobs = await getCronJobs(profileIds);
    return NextResponse.json(
      { jobs },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=20' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof CronProfileRoutingError) {
      return NextResponse.json(
        { jobs: [], error: err.code, detail: msg.slice(0, 240) },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { jobs: [], error: 'cron_fetch_failed', detail: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  if (!isAdminRole(auth.user.role)) return rbacJsonError(403, 'unauthorized', 'Cron changes require admin.');
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 64_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 64_000);
  if (!parsed.ok) return parsed.response;
  const profile = typeof parsed.value.profile === 'string' ? parsed.value.profile : req.nextUrl.searchParams.get('profile') || undefined;
  const scope = profileScopeForUser(auth.user, profile);
  if (!scope.ok) return scope.response;
  const profileId = scope.profiles[0];
  if (!profileId) return rbacJsonError(400, 'invalid_profile', 'Profile is required for cron create.');
  try {
    await getCronJobs([profileId]);
  } catch (err) {
    if (err instanceof CronProfileRoutingError) {
      return NextResponse.json({ ok: false, error: err.code, detail: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'cron_fetch_failed', detail: msg.slice(0, 200) }, { status: 502 });
  }
  return upstreamJson(profileId, 'POST', `/api/jobs?profile=${encodeURIComponent(profileId)}`, { ...parsed.value, profile: profileId }, 10_000);
}
