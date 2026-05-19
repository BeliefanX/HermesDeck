import { NextResponse } from 'next/server';
import { getProfiles } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const profiles = await getProfiles();
    return NextResponse.json(
      { profiles },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { profiles: [], error: 'profiles_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
