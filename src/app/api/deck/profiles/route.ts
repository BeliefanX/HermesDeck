import { NextRequest, NextResponse } from 'next/server';
import { AssignedProfilesUnavailableError, getAssignedRoutableProfiles, getStrictProfiles } from '@/lib/server/hermes';
import { isSuperAdminRole, requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  try {
    const profiles = isSuperAdminRole(auth.user.role)
      ? await getStrictProfiles()
      : await getAssignedRoutableProfiles(auth.user.assignedProfileIds);
    return NextResponse.json(
      { profiles },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unavailable = err instanceof AssignedProfilesUnavailableError;
    return NextResponse.json(
      {
        profiles: [],
        error: unavailable ? err.code : 'profiles_fetch_failed',
        detail: msg.slice(0, 300),
        ...(unavailable ? { unavailableProfiles: err.details } : {}),
      },
      { status: unavailable ? err.status : 502 },
    );
  }
}
