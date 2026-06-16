import { NextRequest, NextResponse } from 'next/server';
import { getMessages, SessionProfileRoutingError } from '@/lib/server/hermes';
import { getProjectedMessages } from '@/lib/server/deck-chat-projection';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ messages: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const beforeRaw = req.nextUrl.searchParams.get('before') || undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  try {
    const decodedId = decodeURIComponent(id);
    const projected = getProjectedMessages(decodedId, profile, {
      limit,
      before: beforeRaw,
      viewer: { userId: auth.user.id, role: auth.user.role },
    });
    if (projected) return NextResponse.json({ messages: projected });
    const messages = await getMessages(decodedId, profile, { limit, before: beforeRaw });
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof SessionProfileRoutingError) {
      return NextResponse.json(
        { messages: [], error: err.code, detail: err.message },
        { status: err.status },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { messages: [], error: 'messages_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
