import { NextRequest, NextResponse } from 'next/server';
import { getMessages } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = req.nextUrl.searchParams.get('profile') || 'default';
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const beforeRaw = req.nextUrl.searchParams.get('before') || undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  try {
    const messages = await getMessages(decodeURIComponent(id), profile, { limit, before: beforeRaw });
    return NextResponse.json({ messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { messages: [], error: 'messages_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
