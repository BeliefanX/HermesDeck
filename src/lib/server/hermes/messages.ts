import type { DeckAttachment, DeckMessage } from '@/lib/types';
import { normalizeAsyncDelegationCompletionMessage } from '@/lib/async-delegation';
import { hermesApiGet, PROFILE_ID_RE } from './core.ts';
import { assertSessionBelongsToProfile } from './sessions.ts';

export interface GetMessagesOptions {
  /** Maximum number of messages to return; clamped by API-backed implementations. */
  limit?: number;
  /** ISO timestamp cursor for older messages. */
  before?: string;
}

interface HermesMessageRow {
  id?: unknown;
  message_id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  created_at?: unknown;
  tool_call_id?: unknown;
  tool_calls?: unknown;
  tool_name?: unknown;
  metadata?: unknown;
  attachments?: unknown;
  token_count?: unknown;
  finish_reason?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
}

interface HermesMessagesResponse {
  object?: unknown;
  session_id?: unknown;
  data?: unknown;
  messages?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function contentValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return isoTimestamp(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function normalizeToolCalls(value: unknown): DeckMessage['toolCalls'] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const calls = parsed
    .filter(isRecord)
    .map((call) => {
      const fn = isRecord(call.function) ? call.function : undefined;
      const name = stringValue(call.name) || stringValue(fn?.name);
      const args = call.arguments ?? fn?.arguments;
      return {
        id: stringValue(call.id),
        name,
        arguments: typeof args === 'string' ? args : args == null ? undefined : contentValue(args),
      };
    })
    .filter((call) => call.id || call.name || call.arguments);
  return calls.length ? calls : undefined;
}

function normalizeAttachments(value: unknown): DeckAttachment[] | undefined {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const attachments = parsed
    .filter(isRecord)
    .map((att, idx): DeckAttachment | null => {
      const id = stringValue(att.id) || `attachment_${idx}`;
      const name = stringValue(att.name) || stringValue(att.filename) || id;
      const mime = stringValue(att.mime) || stringValue(att.mime_type) || 'application/octet-stream';
      const sizeRaw = typeof att.size === 'number' && Number.isFinite(att.size) ? att.size : 0;
      const kind = att.kind === 'text' || att.kind === 'image' || att.kind === 'file'
        ? att.kind
        : mime.startsWith('image/') ? 'image' : mime.startsWith('text/') ? 'text' : 'file';
      return {
        id,
        name,
        mime,
        size: Math.max(0, Math.trunc(sizeRaw)),
        kind,
        text: stringValue(att.text),
        dataUrl: stringValue(att.dataUrl) || stringValue(att.data_url),
        url: stringValue(att.url),
      };
    })
    .filter((att): att is DeckAttachment => att !== null);
  return attachments.length ? attachments : undefined;
}

function normalizeMetadata(row: HermesMessageRow): Record<string, unknown> | undefined {
  const metadata = isRecord(row.metadata) ? { ...row.metadata } : {};
  for (const key of ['token_count', 'finish_reason', 'reasoning', 'reasoning_content'] as const) {
    const value = row[key];
    if (value !== undefined && value !== null) metadata[key] = value;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeMessage(row: HermesMessageRow, fallbackId: string): DeckMessage {
  return normalizeAsyncDelegationCompletionMessage({
    id: String(row.id ?? row.message_id ?? fallbackId),
    role: stringValue(row.role) || 'assistant',
    content: contentValue(row.content),
    createdAt: isoTimestamp(row.timestamp ?? row.created_at),
    metadata: normalizeMetadata(row),
    attachments: normalizeAttachments(row.attachments),
    toolName: stringValue(row.tool_name),
    toolCallId: stringValue(row.tool_call_id),
    toolCalls: normalizeToolCalls(row.tool_calls),
  });
}

function normalizeLimit(limit?: number): number | undefined {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return undefined;
  return Math.min(1000, Math.max(1, Math.trunc(limit)));
}

function validateProfile(profile: string): string {
  const normalized = profile.trim() || 'default';
  if (!PROFILE_ID_RE.test(normalized)) throw new Error(`Invalid Hermes profile id: ${normalized}`);
  return normalized;
}

function rowsFromPayload(payload: HermesMessagesResponse | HermesMessageRow[]): HermesMessageRow[] {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.messages)
        ? payload.messages
        : [];
}

function finalizeMessages(rows: HermesMessageRow[], sessionId: string, opts: GetMessagesOptions): DeckMessage[] {
  const limit = normalizeLimit(opts.limit);
  let messages = rows
    .filter(isRecord)
    .map((row, idx) => normalizeMessage(row as HermesMessageRow, `${sessionId}_${idx}`));

  if (opts.before) {
    const beforeMs = new Date(opts.before).getTime();
    if (Number.isFinite(beforeMs)) {
      messages = messages.filter((message) => {
        if (!message.createdAt) return true;
        const createdMs = new Date(message.createdAt).getTime();
        return Number.isFinite(createdMs) ? createdMs < beforeMs : true;
      });
    }
  }
  if (limit && messages.length > limit) messages = messages.slice(-limit);
  return messages;
}

export async function getMessages(sessionId: string, profile = 'default', opts: GetMessagesOptions = {}): Promise<DeckMessage[]> {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) throw new Error('getMessages: session id is required');
  const scopedProfile = validateProfile(profile);
  await assertSessionBelongsToProfile(trimmedSessionId, scopedProfile);
  const limit = normalizeLimit(opts.limit);
  const params = new URLSearchParams({ profile: scopedProfile });
  if (limit) params.set('limit', String(limit));
  if (opts.before) params.set('before', opts.before);
  const payload = await hermesApiGet<HermesMessagesResponse | HermesMessageRow[]>(
    `/api/sessions/${encodeURIComponent(trimmedSessionId)}/messages?${params.toString()}`,
    10_000,
    scopedProfile,
  );
  return finalizeMessages(rowsFromPayload(payload), trimmedSessionId, opts);
}
