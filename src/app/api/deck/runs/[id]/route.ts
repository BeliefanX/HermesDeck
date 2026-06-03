import { NextRequest, NextResponse } from 'next/server';
import { getRunDetail } from '@/lib/server/hermes';
import { isAdminRole, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

function profileFromRunId(runId: string): string | undefined {
  if (runId.startsWith('run::')) {
    const parts = runId.slice(5).split('::');
    return parts.length >= 3 ? parts[0] : undefined;
  }
  const legacy = runId.match(/^run_([^_]+)_.+_\d+$/);
  return legacy?.[1];
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const profileId = profileFromRunId(id);
  if (!profileId && !isAdminRole(auth.user.role)) {
    return NextResponse.json({ error: 'run_profile_required' }, { status: 403 });
  }
  if (profileId) {
    const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
    if (!access.ok) return access.response;
  }
  try {
    const run = await getRunDetail(id);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'run_detail_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
