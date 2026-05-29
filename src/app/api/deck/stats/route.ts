import { NextResponse } from 'next/server';
import { getDeckStats } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const profile = url.searchParams.get('profile') || undefined;
  if (profile && !PROFILE_ID_RE.test(profile)) {
    return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
  }
  try {
    const stats = await getDeckStats(profile);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'stats_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
