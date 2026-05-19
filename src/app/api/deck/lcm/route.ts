import { NextResponse } from 'next/server';
import { getLcmDashboard } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET() {
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
