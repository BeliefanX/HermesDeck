import { NextRequest, NextResponse } from 'next/server';
import { getModels } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const profile = req.nextUrl.searchParams.get('profile') || 'default';
  const safe = /^[\w.-]{1,64}$/.test(profile) ? profile : 'default';
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
