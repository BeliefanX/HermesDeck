import { NextRequest } from 'next/server';
import { guardMutating, guardRequestBody } from '@/lib/server/csrf';
import { upstreamJson } from '@/lib/server/hermes/deck-agent-api';
import { proveCronJob } from '../route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 1024 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const { jobId } = await ctx.params;
  const id = decodeURIComponent(jobId);
  const proof = await proveCronJob(req, id, true);
  if (!proof.ok) return proof.response;
  return upstreamJson(proof.profile, 'POST', `/api/jobs/${encodeURIComponent(id)}/run?profile=${encodeURIComponent(proof.profile)}`, {}, 10_000);
}
