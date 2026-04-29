import { NextResponse } from 'next/server';
import { getProfiles } from '@/lib/server/hermes';
export const dynamic='force-dynamic';
export async function GET(){ return NextResponse.json({ profiles: await getProfiles() }); }
