import { NextResponse } from 'next/server';
import { getHealth } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET() {
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
