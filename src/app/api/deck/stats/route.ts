import { NextResponse } from 'next/server';
import { getDeckStats } from '@/lib/server/hermes';
import { profileScopeForUser, requireActiveUser } from '@/lib/server/rbac';
import type { DeckStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

function combineStats(parts: DeckStats[]): DeckStats {
  const perSource = new Map<string, number>();
  let lastActiveAt = '';
  for (const part of parts) {
    for (const source of part.perSource) perSource.set(source.source, (perSource.get(source.source) || 0) + source.sessions);
    if (part.lastActiveAt && part.lastActiveAt > lastActiveAt) lastActiveAt = part.lastActiveAt;
  }
  return {
    scope: 'all',
    totalSessions: parts.reduce((sum, part) => sum + part.totalSessions, 0),
    totalMessages: parts.reduce((sum, part) => sum + part.totalMessages, 0),
    activeSessions24h: parts.reduce((sum, part) => sum + part.activeSessions24h, 0),
    activeMessages24h: parts.reduce((sum, part) => sum + part.activeMessages24h, 0),
    perProfile: parts.flatMap((part) => part.perProfile),
    perSource: [...perSource.entries()].map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions),
    lastActiveAt: lastActiveAt || undefined,
  };
}

export async function GET(req: Request) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const profile = url.searchParams.get('profile') || undefined;
  if (profile && !PROFILE_ID_RE.test(profile)) {
    return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
  }
  const scope = profileScopeForUser(auth.user, profile);
  if (!scope.ok) return scope.response;
  try {
    const stats = scope.profiles.length
      ? combineStats(await Promise.all(scope.profiles.map((profileId) => getDeckStats(profileId))))
      : await getDeckStats(profile);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'stats_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
