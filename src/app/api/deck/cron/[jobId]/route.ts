import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { CronProfileRoutingError, getCronJobs } from '@/lib/server/hermes';
import { upstreamJson } from '@/lib/server/hermes/deck-agent-api';
import { isAdminRole, normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function proveCronJob(req: NextRequest, jobId: string, write = false) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth;
  if (write && !isAdminRole(auth.user.role)) return { ok: false as const, response: rbacJsonError(403, 'unauthorized', 'Cron changes require admin.') };
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return { ok: false as const, response: rbacJsonError(400, 'invalid_profile', 'Invalid profile.') };
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access;
  try {
    const job = (await getCronJobs([profile])).find((item) => item.id === jobId);
    if (!job) return { ok: false as const, response: rbacJsonError(403, 'job_unverified', 'Job does not belong to the requested Agent.') };
  } catch (err) {
    if (err instanceof CronProfileRoutingError) {
      return { ok: false as const, response: NextResponse.json({ ok: false, error: err.code, detail: err.message }, { status: err.status }) };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'cron_fetch_failed', detail: msg.slice(0, 200) }, { status: 502 }) };
  }
  return { ok: true as const, profile };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const proof = await proveCronJob(req, decodeURIComponent(jobId));
  if (!proof.ok) return proof.response;
  return upstreamJson(proof.profile, 'GET', `/api/jobs/${encodeURIComponent(decodeURIComponent(jobId))}?profile=${encodeURIComponent(proof.profile)}`, undefined, 8000);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 64_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 64_000);
  if (!parsed.ok) return parsed.response;
  const { jobId } = await ctx.params;
  const id = decodeURIComponent(jobId);
  const proof = await proveCronJob(req, id, true);
  if (!proof.ok) return proof.response;
  return upstreamJson(proof.profile, 'PATCH', `/api/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(proof.profile)}`, parsed.value, 10_000);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const { jobId } = await ctx.params;
  const id = decodeURIComponent(jobId);
  const proof = await proveCronJob(req, id, true);
  if (!proof.ok) return proof.response;
  return upstreamJson(proof.profile, 'DELETE', `/api/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(proof.profile)}`, undefined, 10_000);
}
