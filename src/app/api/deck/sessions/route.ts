import { NextRequest, NextResponse } from 'next/server';
import { getSessions } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profile = req.nextUrl.searchParams.get('profile') || 'default';
  try {
    const sessions = await getSessions(profile);
    return NextResponse.json(
      { sessions },
      { headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=15' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { sessions: [], error: 'sessions_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
