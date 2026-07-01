import { NextRequest } from 'next/server';
import { apiHeaders, getHermesApiBase, redactSecrets } from '@/lib/server/hermes/core';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';
import { hasPendingProjectedApproval, resolvePendingProjectedApproval } from '@/lib/server/deck-chat-projection';

export const dynamic = 'force-dynamic';

const CHOICES = new Set(['once', 'session', 'always', 'deny']);

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 4096 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 4096);
  if (!parsed.ok) return parsed.response;

  const profileId = normalizeProfileId(parsed.value.profileId, 'default');
  const sessionId = typeof parsed.value.sessionId === 'string' ? parsed.value.sessionId.trim() : '';
  const runId = typeof parsed.value.runId === 'string' ? parsed.value.runId.trim() : '';
  const choice = typeof parsed.value.choice === 'string' ? parsed.value.choice.trim() : '';
  if (!profileId) return rbacJsonError(400, 'invalid_profile', 'Invalid profile.');
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;
  if (!sessionId) return rbacJsonError(400, 'invalid_session', 'Invalid session id.');
  if (!/^run_[\w.-]+$/.test(runId)) return rbacJsonError(400, 'invalid_run', 'Invalid run id.');
  if (!CHOICES.has(choice)) return rbacJsonError(400, 'invalid_choice', 'Invalid approval choice.');
  const viewer = { userId: auth.user.id, role: auth.user.role };
  if (!hasPendingProjectedApproval({ sessionId, profileId, runId, viewer })) {
    return rbacJsonError(403, 'approval_unverified', 'Approval does not belong to this authenticated session.');
  }

  const apiBase = getHermesApiBase(profileId);
  if (!apiBase) {
    return Response.json({ error: 'profile_routing_unavailable', detail: `Selected Agent '${profileId}' has no configured API server base.` }, { status: 502 });
  }
  const upstream = await fetch(`${apiBase.replace(/\/+$/, '')}/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    headers: apiHeaders(profileId),
    body: JSON.stringify({ choice }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok) {
    const detail = redactSecrets((await upstream.text().catch(() => '')).slice(0, 480));
    return Response.json({ error: 'approval_failed', detail: detail || 'Approval request failed.' }, { status: upstream.status });
  }
  resolvePendingProjectedApproval({ sessionId, profileId, runId, viewer, choice });
  return Response.json({ ok: true });
}
