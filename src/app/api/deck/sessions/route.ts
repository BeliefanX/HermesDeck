import { NextRequest, NextResponse } from 'next/server';
import { getSessions } from '@/lib/server/hermes';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ sessions: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const sessions = await getSessions(profile);
    return NextResponse.json(
      { sessions },
      { headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=15' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { sessions: [], error: 'sessions_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
