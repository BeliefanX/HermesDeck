import { NextRequest, NextResponse } from 'next/server';
import { getMessages, SessionProfileRoutingError } from '@/lib/server/hermes';
import { finalizeProjectedTurn, getProjectedMessages } from '@/lib/server/deck-chat-projection';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';
import type { DeckMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';

function hasBody(message: DeckMessage): boolean {
  return Boolean(message.content?.trim() || message.toolCalls?.length || message.attachments?.length);
}

function lastIndex(messages: DeckMessage[], predicate: (message: DeckMessage) => boolean): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (predicate(messages[i])) return i;
  }
  return -1;
}

function isRecoverableDraft(messages: DeckMessage[]): boolean {
  const lastAssistant = lastIndex(messages, (message) => message.role === 'assistant');
  if (lastAssistant < 0) return false;
  const draft = messages[lastAssistant];
  return draft.metadata?.projectionStatus === 'draft'
    && !hasBody(draft)
    && messages.slice(0, lastAssistant).some((message) => message.role === 'user');
}

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function findCompletedApiAssistant(projected: DeckMessage[], apiMessages: DeckMessage[]): DeckMessage | null {
  const projectedUser = [...projected].reverse().find((message) => message.role === 'user');
  const projectedUserMs = timestampMs(projectedUser?.createdAt);
  if (!projectedUser || projectedUserMs === undefined) return null;
  const candidateUserIndexes = apiMessages
    .map((message, idx) => ({ message, idx }))
    .filter(({ message }) => (
      message.role === 'user'
      && message.content === projectedUser.content
      && (timestampMs(message.createdAt) ?? -Infinity) >= projectedUserMs
    ))
    .map(({ idx }) => idx);
  if (candidateUserIndexes.length !== 1) return null;
  return apiMessages.slice(candidateUserIndexes[0] + 1).find((message) => (
    message.role === 'assistant'
    && Boolean(message.content?.trim() || message.attachments?.length)
    && !message.toolCalls?.length
    && (!message.metadata?.finish_reason || message.metadata.finish_reason === 'stop')
  )) || null;
}

function isProjectedOverlay(message: DeckMessage): boolean {
  const kind = message.metadata?.projectionKind;
  return kind === 'run-event' || kind === 'approval';
}

function hasCanonicalToolDetails(messages: DeckMessage[]): boolean {
  return messages.some((message) => message.role === 'tool' || (message.toolCalls?.length || 0) > 0);
}

function mergeCanonicalMessages(apiMessages: DeckMessage[], projected: DeckMessage[], limit?: number): DeckMessage[] {
  const ids = new Set(apiMessages.map((message) => message.id));
  const overlays = projected.filter((message) => isProjectedOverlay(message) && !ids.has(message.id));
  const merged = [...apiMessages, ...overlays]
    .sort((a, b) => (timestampMs(a.createdAt) ?? 0) - (timestampMs(b.createdAt) ?? 0));
  return Number.isFinite(limit) && limit && limit > 0 ? merged.slice(-Math.trunc(limit)) : merged;
}

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
    const viewer = { userId: auth.user.id, role: auth.user.role };
    const projected = getProjectedMessages(decodedId, profile, {
      limit,
      before: beforeRaw,
      viewer,
    });
    if (projected) {
      let apiMessages: DeckMessage[];
      try {
        apiMessages = await getMessages(decodedId, profile, { limit, before: beforeRaw });
      } catch (err) {
        if (err instanceof SessionProfileRoutingError) return NextResponse.json({ messages: projected });
        return NextResponse.json({ messages: projected });
      }
      const completed = findCompletedApiAssistant(projected, apiMessages);
      const canonicalHasToolDetails = hasCanonicalToolDetails(apiMessages);
      if (!isRecoverableDraft(projected)) {
        return NextResponse.json({
          messages: canonicalHasToolDetails ? mergeCanonicalMessages(apiMessages, projected, limit) : projected,
        });
      }
      if (!completed) return NextResponse.json({ messages: projected });
      finalizeProjectedTurn({
        sessionId: decodedId,
        profileId: profile,
        viewer,
        content: completed.content,
        attachments: completed.attachments,
        responseId: typeof completed.metadata?.responseId === 'string' ? completed.metadata.responseId : undefined,
      });
      const refreshed = getProjectedMessages(decodedId, profile, {
        limit,
        before: beforeRaw,
        viewer,
      }) || projected;
      return NextResponse.json({ messages: canonicalHasToolDetails ? mergeCanonicalMessages(apiMessages, refreshed, limit) : refreshed });
    }
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
