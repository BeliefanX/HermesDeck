import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/server/hermes';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = req.nextUrl.searchParams.get('profile') || 'default';
  const result = await deleteSession(decodeURIComponent(id), profile);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
