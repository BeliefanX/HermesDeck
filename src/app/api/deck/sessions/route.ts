import { NextRequest, NextResponse } from 'next/server';
import { getSessions, SessionProfileRoutingError } from '@/lib/server/hermes';
import { listProjectedSessions } from '@/lib/server/deck-chat-projection';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';
import type { DeckSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

function mergeSessions(preferred: DeckSession[], fallback: DeckSession[]): DeckSession[] {
  const seen = new Set<string>();
  return [...preferred, ...fallback]
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ sessions: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const projected = listProjectedSessions(profile, { userId: auth.user.id, role: auth.user.role });
    const api = await getSessions(profile);
    const sessions = mergeSessions(projected, api);
    return NextResponse.json(
      { sessions },
      { headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=15' } },
    );
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
