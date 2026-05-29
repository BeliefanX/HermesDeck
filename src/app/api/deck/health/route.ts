import { NextRequest, NextResponse } from 'next/server';
import { getHealth } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const health = await getHealth();
    return NextResponse.json(health, {
      headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=10' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, status: 'unreachable', error: 'health_check_failed', detail: msg.slice(0, 200) },
      { status: 503 },
    );
  }
}
