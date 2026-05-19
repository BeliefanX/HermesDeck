import { NextRequest, NextResponse } from 'next/server';
import { getTokenStats } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('days');
  const days = raw === null ? 14 : Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: 'invalid_days' }, { status: 400 });
  }
  try {
    const stats = await getTokenStats(days);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'tokens_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
