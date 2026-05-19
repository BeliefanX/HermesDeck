import { NextResponse } from 'next/server';
import { getRuns } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const profile = url.searchParams.get('profile') || undefined;
  if (profile && !PROFILE_ID_RE.test(profile)) {
    return NextResponse.json({ runs: [], error: 'invalid_profile' }, { status: 400 });
  }
  try {
    const runs = await getRuns(profile);
    return NextResponse.json(
      { runs },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=20' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { runs: [], error: 'runs_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
