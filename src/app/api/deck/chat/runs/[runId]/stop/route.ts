import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { hasProjectedRun } from '@/lib/server/deck-chat-projection';
import { upstreamJson } from '@/lib/server/hermes/deck-agent-api';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 4096 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 4096);
  if (!parsed.ok) return parsed.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;

  const { runId: rawRunId } = await ctx.params;
  const runId = decodeURIComponent(rawRunId).trim();
  const profile = normalizeProfileId(parsed.value.profileId ?? parsed.value.profile, 'default');
  const sessionId = typeof parsed.value.sessionId === 'string' ? parsed.value.sessionId.trim() : '';
  if (!profile) return rbacJsonError(400, 'invalid_profile', 'Invalid profile.');
  if (!sessionId) return rbacJsonError(400, 'invalid_session', 'Invalid session id.');
  if (!/^run_[\w.-]+$/.test(runId)) return rbacJsonError(400, 'invalid_run', 'Invalid run id.');
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  const viewer = { userId: auth.user.id, role: auth.user.role };
  if (!hasProjectedRun({ sessionId, profileId: profile, runId, viewer })) {
    return rbacJsonError(403, 'run_unverified', 'Run does not belong to this authenticated session.');
  }
  const upstream = await upstreamJson(profile, 'POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {}, 10_000);
  if (!upstream.ok) return upstream;
  const payload = await upstream.json().catch(() => ({}));
  return NextResponse.json({ ok: true, profileId: profile, sessionId, runId, ...payload }, { status: upstream.status });
}
