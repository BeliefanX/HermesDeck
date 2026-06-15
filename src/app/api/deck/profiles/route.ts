import { NextRequest, NextResponse } from 'next/server';
import { fallbackProfilesForUser } from '@/lib/server/profile-catalog-fallback';
import { getProfiles } from '@/lib/server/hermes';
import { filterProfilesForUser, requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  try {
    const profiles = filterProfilesForUser(auth.user, await getProfiles());
    return NextResponse.json(
      { profiles },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const profiles = fallbackProfilesForUser(auth.user);
    if (profiles.length) {
      return NextResponse.json(
        { profiles, warning: 'profiles_catalog_unavailable', detail: msg.slice(0, 200) },
        { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' } },
      );
    }
    return NextResponse.json(
      { profiles: [], error: 'profiles_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
