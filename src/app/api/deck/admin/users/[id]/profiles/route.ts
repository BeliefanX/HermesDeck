import { NextRequest, NextResponse } from 'next/server';
import { getStrictProfiles } from '@/lib/server/hermes';
import { replaceDeckUserProfileAssignments } from '@/lib/server/auth';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { profileIdOf, requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function statusFor(code: string): number {
  if (code === 'not_found') return 404;
  if (code === 'forbidden') return 403;
  return 400;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const mutationGuard = guardMutating(req);
  if (!mutationGuard.ok) return mutationGuard.response;
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 16_000);
  if (!parsed.ok) return parsed.response;

  let validProfileIds: string[];
  try {
    const profiles = await getStrictProfiles();
    validProfileIds = [...new Set(profiles.map((profile) => profileIdOf(profile)).filter((id): id is string => !!id))];
    if (!validProfileIds.length) throw new Error('Hermes Agent returned no profiles.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: 'profiles_fetch_failed',
        detail: `Unable to validate profile assignments against Hermes Agent profiles: ${msg.slice(0, 180)}`,
      },
      { status: 502 },
    );
  }

  const requestedAssignments = parsed.value.assignedProfileIds ?? parsed.value.profileIds;
  const { id } = await ctx.params;
  const result = replaceDeckUserProfileAssignments(auth.user.id, decodeURIComponent(id), requestedAssignments, validProfileIds);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: statusFor(result.code) });
  }
  return NextResponse.json({
    ok: true,
    user: result.user,
    validProfileIds,
  });
}
