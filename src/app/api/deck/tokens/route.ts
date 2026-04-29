import { NextRequest, NextResponse } from 'next/server';
import { getTokenStats } from '@/lib/server/hermes';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get('days') || '14');
  return NextResponse.json(await getTokenStats(days));
}
