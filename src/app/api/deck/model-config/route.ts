import { NextRequest, NextResponse } from 'next/server';
import { getDashboardModelConfig } from '@/lib/server/hermes';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profileId = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profileId) return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;
  const config = await getDashboardModelConfig(profileId);
  // All four reads failed, so this cannot be rendered as a healthy empty config.
  const status = Object.keys(config.errors).length === 4 ? 502 : 200;
  return NextResponse.json(config, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
