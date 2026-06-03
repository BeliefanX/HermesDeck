import { NextRequest, NextResponse } from 'next/server';
import { getModels } from '@/lib/server/hermes';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const safe = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!safe) return NextResponse.json({ providers: [], orphanModels: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, safe, { fallback: safe });
  if (!access.ok) return access.response;
  try {
    const models = await getModels(safe);
    return NextResponse.json(models, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { providers: [], orphanModels: [], error: 'models_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
