import { NextRequest, NextResponse } from 'next/server';
import { getSessions } from '@/lib/server/hermes';
export const dynamic='force-dynamic';
export async function GET(req: NextRequest){ const profile=req.nextUrl.searchParams.get('profile') || 'default'; return NextResponse.json({ sessions: await getSessions(profile) }); }
