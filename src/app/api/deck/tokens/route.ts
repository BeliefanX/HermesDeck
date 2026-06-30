import { NextRequest, NextResponse } from 'next/server';
import { getTokenStats } from '@/lib/server/hermes';
import { isKnownUnavailableError, statusForUnexpectedError } from '../_unavailable';
import { isSuperAdminRole, requireAdmin, requireProfileAccess, rbacJsonError } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function emptyTokenStats(days: number, unavailableReason: string) {
  return {
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, sessions: 0, apiCalls: 0, cost: 0 },
    last24h: { input: 0, output: 0, total: 0, sessions: 0, cost: 0 },
    daily: [],
    hourly: Array(24).fill(0),
    weekday: Array(7).fill(0),
    topModels: [],
    topSources: [],
    windowDays: Math.floor(days),
    unavailableReason,
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const raw = req.nextUrl.searchParams.get('days');
  const days = raw === null ? 14 : Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: 'invalid_days' }, { status: 400 });
  }
  const profile = req.nextUrl.searchParams.get('profile')?.trim() || undefined;
  if (profile) {
    const profileGuard = requireProfileAccess(auth.user, profile);
    if (!profileGuard.ok) return profileGuard.response;
  } else if (!isSuperAdminRole(auth.user.role)) {
    return rbacJsonError(403, 'unauthorized', 'Global token analytics require super_admin.');
  }
  try {
    const stats = await getTokenStats(days, profile);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isKnownUnavailableError(err)) {
      return NextResponse.json({ error: 'token_stats_failed', detail: msg.slice(0, 200) }, { status: statusForUnexpectedError(err) });
    }
    return NextResponse.json(
      emptyTokenStats(days, msg.slice(0, 200)),
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
    );
  }
}
