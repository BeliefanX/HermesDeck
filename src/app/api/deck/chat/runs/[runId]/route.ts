import { NextRequest, NextResponse } from 'next/server';
import { hermesApiGet } from '@/lib/server/hermes/core';
import { hasProjectedRun } from '@/lib/server/deck-chat-projection';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function runIdFrom(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const { runId: rawRunId } = await ctx.params;
  const runId = runIdFrom(rawRunId).trim();
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  const sessionId = (req.nextUrl.searchParams.get('sessionId') || '').trim();
  if (!profile) return rbacJsonError(400, 'invalid_profile', 'Invalid profile.');
  if (!sessionId) return rbacJsonError(400, 'invalid_session', 'Invalid session id.');
  if (!/^run_[\w.-]+$/.test(runId)) return rbacJsonError(400, 'invalid_run', 'Invalid run id.');
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  const viewer = { userId: auth.user.id, role: auth.user.role };
  if (!hasProjectedRun({ sessionId, profileId: profile, runId, viewer })) {
    return rbacJsonError(403, 'run_unverified', 'Run does not belong to this authenticated session.');
  }
  try {
    const run = await hermesApiGet<unknown>(`/v1/runs/${encodeURIComponent(runId)}`, 5000, profile);
    return NextResponse.json({ ok: true, profileId: profile, sessionId, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'run_status_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
