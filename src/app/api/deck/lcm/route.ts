import { NextRequest, NextResponse } from 'next/server';
import { getLcmDashboard } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const data = await getLcmDashboard();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'lcm_fetch_failed', detail: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}
