import { NextResponse } from 'next/server';
import { CronProfileRoutingError, getCronJobs, getProfiles } from '@/lib/server/hermes';
import { PROFILE_ID_RE, filterProfilesForUser, profileScopeForUser, requireActiveUser } from '@/lib/server/rbac';

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
      const profiles = filterProfilesForUser(auth.user, await getProfiles());
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
