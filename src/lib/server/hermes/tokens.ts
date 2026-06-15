import type { TokenStats } from '@/lib/types';
import { makeKeyedCache, PROFILE_ID_RE } from './core';

const API_GAP_MESSAGE = 'Hermes Agent API does not currently expose token analytics endpoints required by HermesDeck. Direct local runtime storage reads are disabled.';

function safeDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 14;
}

async function getTokenStatsUncached(key: string): Promise<TokenStats> {
  const [_daysRaw = '14', profileRaw = ''] = key.split('|');
  const profile = profileRaw || undefined;
  if (profile && profile !== 'all' && !PROFILE_ID_RE.test(profile)) throw new Error('invalid_profile');
  throw new Error(`getTokenStats: ${API_GAP_MESSAGE}`);
}

const tokenStatsCache = makeKeyedCache<string, TokenStats>(10_000, getTokenStatsUncached);

export async function getTokenStats(days = 14, profileId?: string): Promise<TokenStats> {
  const normalizedDays = safeDays(days);
  const profile = profileId?.trim() || '';
  if (profile && profile !== 'all' && !PROFILE_ID_RE.test(profile)) throw new Error('invalid_profile');
  return tokenStatsCache(`${normalizedDays}|${profile}`);
}
