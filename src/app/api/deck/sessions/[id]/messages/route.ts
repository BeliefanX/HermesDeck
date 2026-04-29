import { NextRequest, NextResponse } from 'next/server';
import { getMessages } from '@/lib/server/hermes';
export const dynamic='force-dynamic';
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }){ const { id } = await ctx.params; const profile=req.nextUrl.searchParams.get('profile') || 'default'; return NextResponse.json({ messages: await getMessages(decodeURIComponent(id), profile) }); }
