import { NextRequest, NextResponse } from 'next/server';
import { updateDeckUserByAdmin } from '@/lib/server/auth';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function statusFor(code: string): number {
  if (code === 'not_found') return 404;
  if (code === 'forbidden') return 403;
  return 400;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const mutationGuard = guardMutating(req);
  if (!mutationGuard.ok) return mutationGuard.response;
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 16_000);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = updateDeckUserByAdmin(auth.user.id, decodeURIComponent(id), parsed.value);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: statusFor(result.code) });
  }
  return NextResponse.json({ ok: true, user: result.user });
}
