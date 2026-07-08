import { NextRequest, NextResponse } from 'next/server';
import { hermesApiGet } from '@/lib/server/hermes/core';
import { record, safeSummary } from '@/lib/server/hermes/deck-agent-api';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const raw = await hermesApiGet<unknown>('/v1/capabilities', 5000, profile);
    const row = record(raw);
    return NextResponse.json({
      ok: true,
      profileId: profile,
      features: record(row.features),
      endpoints: record(row.endpoints),
      summary: safeSummary(row),
    }, { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'capabilities_fetch_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
