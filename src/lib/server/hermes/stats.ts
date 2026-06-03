import type { DeckStats } from '@/lib/types';
import { getSessionsForStats } from './sessions';

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

export async function getDeckStats(profile?: string): Promise<DeckStats> {
  const sessions = await getSessionsForStats(profile);
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

    const profileId = session.profileId || profile || 'default';
    const profileBucket = perProfile.get(profileId) || { sessions: 0, messages: 0, lastActiveAt: undefined };
    profileBucket.sessions += 1;
    profileBucket.messages += messages;
    profileBucket.lastActiveAt = maxIso(profileBucket.lastActiveAt, activeAt);
    perProfile.set(profileId, profileBucket);

    const source = session.source || 'api';
    perSource.set(source, (perSource.get(source) || 0) + 1);
  }

  return {
    scope: profile || 'all',
    totalSessions: sessions.length,
    totalMessages,
    activeSessions24h,
    activeMessages24h,
    perProfile: [...perProfile.entries()]
      .map(([profileId, value]) => ({ profileId, ...value }))
      .sort((a, b) => b.sessions - a.sessions || a.profileId.localeCompare(b.profileId)),
    perSource: [...perSource.entries()]
      .map(([source, count]) => ({ source, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source)),
    lastActiveAt,
  };
}
