import { NextRequest, NextResponse } from 'next/server';
import { hermesApiGet } from '@/lib/server/hermes/core';
import { record } from '@/lib/server/hermes/deck-agent-api';
import { isAdminRole, normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function redacted(payload: unknown, admin: boolean) {
  const row = record(payload);
  const base: Record<string, unknown> = {
    ok: row.status === 'ok' || row.ok === true,
    status: row.status || (row.ok === true ? 'ok' : 'unknown'),
    platform: row.platform,
    version: row.version,
    gatewayState: row.gateway_state,
    activeAgents: row.active_agents,
    gatewayBusy: row.gateway_busy,
    gatewayDrainable: row.gateway_drainable,
    updatedAt: row.updated_at,
  };
  if (admin) {
    base.exitReason = row.exit_reason;
    base.pid = row.pid;
    base.platforms = row.platforms;
  }
  return base;
}

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const raw = await hermesApiGet<unknown>('/health/detailed', 5000, profile);
    return NextResponse.json({ profileId: profile, ...redacted(raw, isAdminRole(auth.user.role)) }, {
      headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=10' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, status: 'unreachable', error: 'gateway_status_failed', detail: msg.slice(0, 200) }, { status: 503 });
  }
}
