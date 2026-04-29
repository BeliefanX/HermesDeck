import { NextResponse } from 'next/server';
import { getTools } from '@/lib/server/hermes';
export const dynamic='force-dynamic';
export async function GET(){ return NextResponse.json({ tools: await getTools() }); }
