import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/server/hermes';
import { guardMutating } from '@/lib/server/csrf';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ ok: false, removed: 0, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const result = await deleteSession(decodeURIComponent(id), profile);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, removed: 0, error: 'session_delete_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
