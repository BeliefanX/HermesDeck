import { NextRequest, NextResponse } from 'next/server';
import { getTools } from '@/lib/server/hermes';
import { isSuperAdminRole, normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ tools: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const tools = await getTools(profile, { allowLocalFallback: isSuperAdminRole(auth.user.role) });
    return NextResponse.json(
      { tools },
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { tools: [], error: 'tools_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
