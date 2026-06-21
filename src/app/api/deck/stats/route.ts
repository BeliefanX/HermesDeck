import { NextResponse } from 'next/server';
import { getDeckStats, getSessionsForStats, SessionProfileRoutingError } from '@/lib/server/hermes';
import { listProjectedSessions, type ProjectionViewer } from '@/lib/server/deck-chat-projection';
import { profileScopeForUser, requireActiveUser } from '@/lib/server/rbac';
import type { DeckSession, DeckStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROFILE_ID_RE = /^[\w.-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function timeMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function maxIso(a?: string, b?: string): string | undefined {
  const am = timeMs(a) ?? -Infinity;
  const bm = timeMs(b) ?? -Infinity;
  if (am === -Infinity && bm === -Infinity) return undefined;
  return bm > am ? b : a;
}

function mergeSessionRows(preferred: DeckSession[], fallback: DeckSession[]): DeckSession[] {
  const seen = new Set<string>();
  return [...preferred, ...fallback].filter((session) => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return true;
  });
}

function statsFromSessions(sessions: DeckSession[], scope: string): DeckStats {
  const since = Date.now() - DAY_MS;
  const perProfile = new Map<string, { sessions: number; messages: number; lastActiveAt?: string }>();
  const perSource = new Map<string, number>();
  let totalMessages = 0;
  let activeSessions24h = 0;
  let activeMessages24h = 0;
  let lastActiveAt: string | undefined;

  for (const session of sessions) {
    const messages = Math.max(0, Math.trunc(session.messageCount || 0));
    totalMessages += messages;
    const activeAt = session.updatedAt || session.createdAt;
    lastActiveAt = maxIso(lastActiveAt, activeAt);

    const startedMs = timeMs(session.createdAt);
    if (startedMs !== undefined && startedMs >= since) activeSessions24h += 1;
    const activeMs = timeMs(activeAt);
    if (activeMs !== undefined && activeMs >= since) activeMessages24h += messages;

    const profileId = session.profileId || scope || 'default';
    const profileBucket = perProfile.get(profileId) || { sessions: 0, messages: 0, lastActiveAt: undefined };
    profileBucket.sessions += 1;
    profileBucket.messages += messages;
    profileBucket.lastActiveAt = maxIso(profileBucket.lastActiveAt, activeAt);
    perProfile.set(profileId, profileBucket);

    const source = session.source || 'api';
    perSource.set(source, (perSource.get(source) || 0) + 1);
  }

  return {
    scope,
    totalSessions: sessions.length,
    totalMessages,
    activeSessions24h,
    activeMessages24h,
    perProfile: [...perProfile.entries()]
      .map(([profileId, value]) => ({ profileId, ...value }))
      .sort((a, b) => b.sessions - a.sessions || a.profileId.localeCompare(b.profileId)),
    perSource: [...perSource.entries()]
      .map(([source, sessionsCount]) => ({ source, sessions: sessionsCount }))
      .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source)),
    lastActiveAt,
  };
}

function combineStats(parts: DeckStats[], scope = 'all'): DeckStats {
  const perSource = new Map<string, number>();
  let lastActiveAt = '';
  for (const part of parts) {
    for (const source of part.perSource) perSource.set(source.source, (perSource.get(source.source) || 0) + source.sessions);
    if (part.lastActiveAt && part.lastActiveAt > lastActiveAt) lastActiveAt = part.lastActiveAt;
  }
  return {
    scope,
    totalSessions: parts.reduce((sum, part) => sum + part.totalSessions, 0),
    totalMessages: parts.reduce((sum, part) => sum + part.totalMessages, 0),
    activeSessions24h: parts.reduce((sum, part) => sum + part.activeSessions24h, 0),
    activeMessages24h: parts.reduce((sum, part) => sum + part.activeMessages24h, 0),
    perProfile: parts.flatMap((part) => part.perProfile),
    perSource: [...perSource.entries()].map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions),
    lastActiveAt: lastActiveAt || undefined,
  };
}

async function projectionAndApiStats(profile: string, viewer: ProjectionViewer): Promise<DeckStats> {
  const projected = listProjectedSessions(profile, viewer);
  try {
    const api = await getSessionsForStats(profile);
    return statsFromSessions(mergeSessionRows(projected, api), profile);
  } catch (err) {
    if (err instanceof SessionProfileRoutingError && projected.length > 0) {
      return statsFromSessions(projected, profile);
    }
    throw err;
  }
}

function projectedOrApiStats(profile: string | undefined, viewer: ProjectionViewer): Promise<DeckStats> | DeckStats {
  if (profile) return projectionAndApiStats(profile, viewer);
  return getDeckStats(profile);
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
    const viewer = { userId: auth.user.id, role: auth.user.role };
    const stats = scope.profiles.length
      ? combineStats(await Promise.all(scope.profiles.map((profileId) => projectedOrApiStats(profileId, viewer))), scope.requested ?? 'all')
      : await projectedOrApiStats(profile, viewer);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    if (err instanceof SessionProfileRoutingError) {
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status: err.status },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'stats_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
