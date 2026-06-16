import { NextRequest, NextResponse } from 'next/server';
import { listDeckSessionsForProfile } from '@/lib/server/deck-session-list';
import { SessionProfileRoutingError } from '@/lib/server/hermes';
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
    const result = await listDeckSessionsForProfile(profile, { userId: auth.user.id, role: auth.user.role });
    const headers: Record<string, string> = { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=15' };
    if (result.warning) headers['X-HermesDeck-Warning'] = result.warning.code;
    return NextResponse.json(result, { headers });
  } catch (err) {
    if (err instanceof SessionProfileRoutingError) {
      return NextResponse.json(
        { sessions: [], error: err.code, detail: err.message },
        { status: err.status },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { sessions: [], error: 'sessions_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
