import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DeckAttachment, DeckMessage, DeckSession } from '@/lib/types';
import {
  PROFILE_ROUTING_UNAVAILABLE,
  SESSION_PROFILE_MISMATCH,
  SessionProfileRoutingError,
} from './hermes/sessions.ts';

const STORE_VERSION = 1;
const DATA_DIR = process.env.HERMESDECK_DATA_DIR || process.env.HERMESDECK_AUTH_DIR || join(homedir(), '.hermesdeck');
const STORE_FILE = join(DATA_DIR, 'chat-projection.v1.json');
const LOCK_FILE = `${STORE_FILE}.lock`;
const MAX_IMPORTED_SESSIONS = 500;
const MAX_MESSAGES_PER_SESSION = 1000;
const MAX_STORED_SESSIONS = 750;
const MAX_ACTIVE_OR_ERRORED_SESSIONS = 200;
const COMPLETED_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const FAILED_OR_RUNNING_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

export type ProjectedSessionStatus = 'running' | 'completed' | 'failed';

type ProjectedMessage = DeckMessage & {
  updatedAt?: string;
};

type ProjectedSession = DeckSession & {
  ownerUserId?: string;
  ownerRole?: string;
  status?: ProjectedSessionStatus;
  responseId?: string;
  previousResponseId?: string;
  aliases?: string[];
  lastError?: string;
  messages: ProjectedMessage[];
};

type ProjectionStore = {
  version: typeof STORE_VERSION;
  sessions: Record<string, ProjectedSession>;
  aliases: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type StartProjectedTurnInput = {
  sessionId: string;
  profileId: string;
  ownerUserId: string;
  ownerRole: string;
  message: string;
  attachments?: unknown;
  model?: string;
  reasoningEffort?: string;
  previousResponseId?: string;
};

export type FinalizeProjectedTurnInput = {
  sessionId: string;
  profileId: string;
  viewer?: ProjectionViewer;
  content?: string;
  responseId?: string;
  attachments?: unknown;
  model?: string;
  reasoningEffort?: string;
};

export type RecordProjectedErrorInput = {
  sessionId: string;
  profileId: string;
  viewer?: ProjectionViewer;
  error: string;
  detail?: string;
};

export type RecordProjectedRunEventInput = {
  sessionId: string;
  profileId: string;
  viewer?: ProjectionViewer;
  type: string;
  payload: unknown;
};

export type ProjectionViewer = {
  userId: string;
  role?: string;
};

export type ImportProjectedChatStateInput = {
  profileId: string;
  ownerUserId: string;
  ownerRole: string;
  sessions: unknown;
  messages: unknown;
  responseIds?: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): ProjectionStore {
  const now = nowIso();
  return { version: STORE_VERSION, sessions: {}, aliases: {}, createdAt: now, updatedAt: now };
}

function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(DATA_DIR, 0o700); } catch {}
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.abs(value) < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function sanitizeText(value: unknown, max = 200_000): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (value == null) return '';
  try { return JSON.stringify(value).slice(0, max); } catch { return String(value).slice(0, max); }
}

function sanitizeAttachment(value: unknown, idx: number): DeckAttachment | null {
  const rec = safeRecord(value);
  if (!rec) return null;
  const mime = stringValue(rec.mime) || stringValue(rec.mime_type) || 'application/octet-stream';
  const kindRaw = rec.kind;
  const kind: DeckAttachment['kind'] = kindRaw === 'text' || kindRaw === 'image' || kindRaw === 'file'
    ? kindRaw
    : mime.startsWith('image/') ? 'image' : mime.startsWith('text/') ? 'text' : 'file';
  const rawSize = typeof rec.size === 'number' && Number.isFinite(rec.size) ? rec.size : 0;
  const dataUrl = stringValue(rec.dataUrl) || stringValue(rec.data_url);
  return {
    id: stringValue(rec.id) || `attachment_${idx}`,
    name: stringValue(rec.name) || stringValue(rec.filename) || `attachment_${idx}`,
    mime,
    size: Math.max(0, Math.trunc(rawSize)),
    kind,
    text: stringValue(rec.text)?.slice(0, 100_000),
    // Avoid making the server projection a huge binary blob store. Keep small
    // inline artifacts only; large images/files should stay in Hermes output or
    // browser cache and can be reattached by the user if needed.
    dataUrl: dataUrl && dataUrl.length <= 120_000 ? dataUrl : undefined,
    url: stringValue(rec.url),
  };
}

function sanitizeAttachments(value: unknown): DeckAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .slice(0, 20)
    .map((item, idx) => sanitizeAttachment(item, idx))
    .filter((item): item is DeckAttachment => item !== null);
  return attachments.length ? attachments : undefined;
}

function normalizeRole(value: unknown): DeckMessage['role'] {
  const role = stringValue(value) || 'assistant';
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return role as DeckMessage['role'];
}

function sanitizeMessage(value: unknown, fallbackId: string): ProjectedMessage | null {
  const rec = safeRecord(value);
  if (!rec) return null;
  const id = stringValue(rec.id) || fallbackId;
  if (!id) return null;
  const toolCalls = Array.isArray(rec.toolCalls)
    ? rec.toolCalls
      .slice(0, 50)
      .filter((call) => !!safeRecord(call))
      .map((call) => {
        const c = call as Record<string, unknown>;
        return {
          id: stringValue(c.id),
          name: stringValue(c.name),
          arguments: typeof c.arguments === 'string' ? c.arguments.slice(0, 200_000) : undefined,
        };
      })
      .filter((call) => call.id || call.name || call.arguments)
    : undefined;
  return {
    id,
    role: normalizeRole(rec.role),
    content: sanitizeText(rec.content),
    createdAt: isoTimestamp(rec.createdAt) || nowIso(),
    metadata: safeRecord(rec.metadata) || undefined,
    attachments: sanitizeAttachments(rec.attachments),
    toolName: stringValue(rec.toolName),
    toolCallId: stringValue(rec.toolCallId),
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
}

function normalizeProfile(profileId: string): string {
  return profileId.trim() || 'default';
}

function readStore(): ProjectionStore {
  ensureDataDir();
  if (!existsSync(STORE_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Partial<ProjectionStore>;
    if (parsed?.version !== STORE_VERSION || !safeRecord(parsed.sessions) || !safeRecord(parsed.aliases)) return emptyStore();
    return {
      version: STORE_VERSION,
      sessions: parsed.sessions as Record<string, ProjectedSession>,
      aliases: parsed.aliases as Record<string, string>,
      createdAt: stringValue(parsed.createdAt) || nowIso(),
      updatedAt: stringValue(parsed.updatedAt) || nowIso(),
    };
  } catch {
    return emptyStore();
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withStoreLock<T>(fn: () => T): T {
  ensureDataDir();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner = `${process.pid}:${randomUUID()}`;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(LOCK_FILE, 'wx', 0o600);
      writeFileSync(fd, `${owner}\n${nowIso()}\n`);
      try { fsyncSync(fd); } catch {}
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      try {
        const stat = readFileSync(LOCK_FILE, 'utf8');
        const ts = isoTimestamp(stat.split(/\r?\n/)[1]);
        if (!ts || Date.now() - new Date(ts).getTime() > LOCK_STALE_MS) {
          rmSync(LOCK_FILE, { force: true });
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) throw new Error('Timed out acquiring Deck chat projection store lock.');
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
      try {
        const currentOwner = readFileSync(LOCK_FILE, 'utf8').split(/\r?\n/)[0];
        if (currentOwner === owner) rmSync(LOCK_FILE, { force: true });
      } catch {}
    }
  }
}

function sessionTime(session: ProjectedSession): number {
  const ts = isoTimestamp(session.updatedAt) || isoTimestamp(session.createdAt);
  return ts ? new Date(ts).getTime() : 0;
}

function pruneStore(store: ProjectionStore): void {
  const now = Date.now();
  const entries = Object.entries(store.sessions);
  const keep = new Set<string>();

  entries
    .filter(([, session]) => session.status === 'running' || session.status === 'failed')
    .sort((a, b) => sessionTime(b[1]) - sessionTime(a[1]))
    .slice(0, Math.min(MAX_ACTIVE_OR_ERRORED_SESSIONS, MAX_STORED_SESSIONS))
    .forEach(([id]) => keep.add(id));

  const ttlEligible = entries
    .filter(([id, session]) => {
      if (keep.has(id)) return false;
      const age = now - sessionTime(session);
      const ttl = session.status === 'completed' ? COMPLETED_SESSION_TTL_MS : FAILED_OR_RUNNING_SESSION_TTL_MS;
      return age <= ttl;
    })
    .sort((a, b) => sessionTime(b[1]) - sessionTime(a[1]));

  for (const [id] of ttlEligible) {
    if (keep.size >= MAX_STORED_SESSIONS) break;
    keep.add(id);
  }

  const retained = Object.fromEntries(entries.filter(([id]) => keep.has(id))) as Record<string, ProjectedSession>;
  store.sessions = retained;
  store.aliases = Object.fromEntries(
    Object.entries(store.aliases).filter(([alias, target]) => Boolean(retained[target] || retained[alias])),
  );
}

function writeStore(store: ProjectionStore): void {
  ensureDataDir();
  pruneStore(store);
  const next = { ...store, updatedAt: nowIso() };
  const tmp = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  const fd = openSync(tmp, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, STORE_FILE);
}

function mutateStore<T>(fn: (store: ProjectionStore) => T | false): T | false {
  return withStoreLock(() => {
    const store = readStore();
    const result = fn(store);
    if (result === false) return result;
    writeStore(store);
    return result;
  });
}

function resolveAlias(store: ProjectionStore, sessionId: string): string {
  let cur = sessionId;
  const seen = new Set<string>();
  while (store.aliases[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = store.aliases[cur];
  }
  return cur;
}

function previewTitle(text: string, fallback: string): string {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || fallback;
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

function messageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function sessionSummary(session: ProjectedSession): DeckSession {
  return {
    id: session.id,
    profileId: session.profileId,
    title: session.title,
    source: session.source || 'hermesdeck',
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length ?? session.messageCount ?? 0,
    pinned: session.pinned,
    folderId: session.folderId,
    parentSessionId: session.parentSessionId,
    childCount: session.childCount,
  };
}

function findAssistantDraft(session: ProjectedSession): ProjectedMessage | undefined {
  for (let idx = session.messages.length - 1; idx >= 0; idx -= 1) {
    const msg = session.messages[idx];
    if (msg.role === 'assistant' && msg.metadata?.projectionStatus === 'draft') return msg;
  }
  return undefined;
}

type ProjectedToolSlot = {
  message: ProjectedMessage;
  name: string;
  args: string;
  itemId?: string;
  callId?: string;
};

function toolCallIds(item: Record<string, unknown>, fallback = ''): { primary: string; itemId: string; callId: string } {
  const itemId = String((item.id as string) || fallback || '');
  const callId = String((item.call_id as string) || (item.tool_call_id as string) || '');
  return { primary: callId || itemId, itemId, callId };
}

function isFunctionCallItemType(t: unknown): boolean {
  if (typeof t !== 'string') return false;
  return t === 'function_call' || t === 'tool_call' || t === 'mcp_call' || t === 'tool_use';
}

function isToolArgsDelta(type: string): boolean {
  return /(?:function_call|tool_call)[._-]arguments\.delta$/i.test(type)
    || /\bfunction_call\.arguments\.delta$/i.test(type);
}

function isToolArgsDone(type: string): boolean {
  return /(?:function_call|tool_call)[._-]arguments\.done$/i.test(type)
    || /\bfunction_call\.arguments\.done$/i.test(type);
}

function isToolResultEvent(type: string): boolean {
  return type === 'tool.result'
    || type === 'tool.completed'
    || type === 'tool.output'
    || type === 'response.tool_call.output'
    || type === 'response.tool_call.completed'
    || type === 'response.function_call.output'
    || type === 'response.tool_result';
}

function normalizeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const parts = output.map((part) => {
      if (!part || typeof part !== 'object') return '';
      const rec = part as Record<string, unknown>;
      return typeof rec.text === 'string' ? rec.text : '';
    }).filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  return sanitizeText(output);
}

function getProjectedToolSlot(session: ProjectedSession, id: string): ProjectedToolSlot | undefined {
  if (!id) return undefined;
  for (const message of session.messages) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    const metadata = safeRecord(message.metadata) || {};
    for (const tc of message.toolCalls) {
      const itemId = stringValue(metadata.toolItemId) || stringValue(metadata.itemId);
      const callId = stringValue(metadata.toolCallId) || stringValue(metadata.callId) || stringValue(tc.id);
      if (tc.id !== id && itemId !== id && callId !== id) continue;
      return {
        message,
        name: tc.name || stringValue(message.toolName) || 'tool',
        args: tc.arguments || '',
        itemId,
        callId,
      };
    }
  }
  return undefined;
}

function upsertToolCallMessage(session: ProjectedSession, input: {
  primary: string;
  itemId?: string;
  callId?: string;
  name: string;
  args: string;
  now: string;
}): boolean {
  const existing = getProjectedToolSlot(session, input.primary)
    || (input.itemId ? getProjectedToolSlot(session, input.itemId) : undefined)
    || (input.callId ? getProjectedToolSlot(session, input.callId) : undefined);
  const visibleId = input.callId || input.primary;
  if (existing) {
    const nextName = input.name || existing.name;
    const nextMetadata = {
      ...(existing.message.metadata || {}),
      observedFrom: 'deck-stream',
      projectionKind: 'tool-call',
      toolItemId: input.itemId || existing.itemId,
      toolCallId: input.callId || existing.callId || visibleId,
    };
    const current = existing.message.toolCalls?.[0];
    const unchanged = existing.message.toolName === nextName
      && current?.id === visibleId
      && current?.name === nextName
      && current?.arguments === input.args
      && stringValue(existing.message.metadata?.toolItemId) === stringValue(nextMetadata.toolItemId)
      && stringValue(existing.message.metadata?.toolCallId) === stringValue(nextMetadata.toolCallId)
      && existing.message.metadata?.observedFrom === nextMetadata.observedFrom
      && existing.message.metadata?.projectionKind === nextMetadata.projectionKind;
    if (unchanged) return false;
    existing.message.toolName = nextName;
    existing.message.toolCalls = [{ id: visibleId, name: nextName, arguments: input.args }];
    existing.message.metadata = nextMetadata;
    existing.message.updatedAt = input.now;
    return true;
  }

  const draft = findAssistantDraft(session);
  if (draft && !draft.content && !(draft.toolCalls?.length) && !(draft.attachments?.length)) {
    session.messages = session.messages.filter((message) => message !== draft);
  }
  const row: ProjectedMessage = {
    id: `tc_${visibleId || randomUUID().slice(0, 8)}`,
    role: 'assistant',
    content: '',
    createdAt: input.now,
    toolName: input.name,
    toolCalls: [{ id: visibleId, name: input.name, arguments: input.args }],
    metadata: {
      observedFrom: 'deck-stream',
      projectionKind: 'tool-call',
      toolItemId: input.itemId,
      toolCallId: input.callId || visibleId,
    },
  };
  session.messages.push(row);
  session.messages.push({
    id: messageId('a'),
    role: 'assistant',
    content: '',
    createdAt: input.now,
    metadata: { observedFrom: 'deck-stream', projectionStatus: 'draft' },
  });
  return true;
}

function insertToolResultMessage(session: ProjectedSession, input: {
  itemId: string;
  toolName: string;
  content: string;
  now: string;
}): boolean {
  if (!input.itemId || session.messages.some((message) => message.role === 'tool' && message.toolCallId === input.itemId)) return false;
  const slot = getProjectedToolSlot(session, input.itemId);
  const row: ProjectedMessage = {
    id: `tr_${input.itemId}`,
    role: 'tool',
    content: input.content,
    toolName: input.toolName,
    toolCallId: input.itemId,
    createdAt: input.now,
    metadata: { observedFrom: 'deck-stream', projectionKind: 'tool-result' },
  };
  const idx = slot ? session.messages.findIndex((message) => message.id === slot.message.id) : -1;
  if (idx >= 0) session.messages.splice(idx + 1, 0, row);
  else session.messages.push(row);
  return true;
}

function isProjectableRunEvent(type: string, payload: Record<string, unknown>, item: Record<string, unknown>): boolean {
  if (type === 'response.output_item.added') return isFunctionCallItemType(item.type);
  if (isToolArgsDelta(type)) return false;
  if (isToolArgsDone(type)) {
    const args = typeof payload.arguments === 'string'
      ? payload.arguments
      : (typeof item.arguments === 'string' ? item.arguments : '');
    return Boolean(String((payload.item_id as string) || (item.id as string) || '') && args);
  }
  if (type === 'response.output_item.done') {
    if (isFunctionCallItemType(item.type) && typeof item.arguments === 'string') return true;
    const itype = String(item.type || '');
    if (itype !== 'tool_result' && itype !== 'function_call_output' && itype !== 'tool_output') return false;
    const itemId = String((item.call_id as string) || (item.tool_call_id as string) || (item.id as string) || '');
    return Boolean(itemId && (item.output ?? item.content) != null);
  }
  if (isToolResultEvent(type)) {
    const itemId = String(
      (payload.item_id as string)
      || (payload.tool_call_id as string)
      || (payload.call_id as string)
      || (item.id as string)
      || ''
    );
    return Boolean(itemId && (payload.output ?? payload.result ?? payload.content) != null);
  }
  return false;
}

function canViewProjectedSession(session: ProjectedSession, viewer?: ProjectionViewer): boolean {
  void session;
  void viewer;
  return true;
}

function canWriteProjectedSession(session: ProjectedSession, viewer?: ProjectionViewer): boolean {
  void session;
  void viewer;
  return true;
}

function assertCanWriteProjectedSession(session: ProjectedSession, viewer?: ProjectionViewer): void {
  if (canWriteProjectedSession(session, viewer)) return;
  throw new SessionProfileRoutingError(
    SESSION_PROFILE_MISMATCH,
    'Projected session does not belong to the authenticated user.',
    403,
  );
}

export function startProjectedTurn(input: StartProjectedTurnInput): void {
  const profileId = normalizeProfile(input.profileId);
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;
  const text = sanitizeText(input.message);
  const attachments = sanitizeAttachments(input.attachments);
  mutateStore((store) => {
    const canonicalId = resolveAlias(store, sessionId);
    const now = nowIso();
    let session = store.sessions[canonicalId];
    if (!session) {
      session = {
        id: canonicalId,
        profileId,
        title: previewTitle(text, canonicalId),
        source: 'hermesdeck',
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        ownerUserId: input.ownerUserId,
        ownerRole: input.ownerRole,
        status: 'running',
        previousResponseId: input.previousResponseId,
        messages: [],
      };
      store.sessions[canonicalId] = session;
    }
    if (session.profileId !== profileId) {
      throw new SessionProfileRoutingError(
        SESSION_PROFILE_MISMATCH,
        'Projected session belongs to a different profile.',
        403,
      );
    }
    assertCanWriteProjectedSession(session, { userId: input.ownerUserId, role: input.ownerRole });
    session.ownerUserId ||= input.ownerUserId;
    session.ownerRole ||= input.ownerRole;
    session.model = input.model || session.model;
    session.reasoningEffort = input.reasoningEffort || session.reasoningEffort;
    session.previousResponseId = input.previousResponseId || session.previousResponseId;
    session.status = 'running';
    session.updatedAt = now;
    if (text) {
      session.messages.push({
        id: messageId('u'),
        role: 'user',
        content: text,
        createdAt: now,
        attachments,
        metadata: { observedFrom: 'deck-stream' },
      });
    }
    session.messages.push({
      id: messageId('a'),
      role: 'assistant',
      content: '',
      createdAt: now,
      metadata: { observedFrom: 'deck-stream', projectionStatus: 'draft' },
    });
    session.messageCount = session.messages.length;
  });
}

export function reconcileProjectedSessionId(oldSessionId: string, newSessionId: string, profileId: string, viewer?: ProjectionViewer): void {
  const oldId = oldSessionId.trim();
  const nextId = newSessionId.trim();
  if (!oldId || !nextId || oldId === nextId) return;
  const profile = normalizeProfile(profileId);
  mutateStore((store) => {
    const canonicalOld = resolveAlias(store, oldId);
    const canonicalNew = resolveAlias(store, nextId);
    const oldSession = store.sessions[canonicalOld];
    const newSession = store.sessions[canonicalNew];
    const session = oldSession || newSession;
    if (!session) {
      store.aliases[oldId] = nextId;
      return;
    }
    if (session.profileId !== profile) {
      throw new SessionProfileRoutingError(SESSION_PROFILE_MISMATCH, 'Projected session belongs to a different profile.', 403);
    }
    assertCanWriteProjectedSession(session, viewer);
    const aliases = new Set([...(session.aliases || []), oldId, canonicalOld].filter((id) => id && id !== nextId));
    session.id = nextId;
    session.aliases = [...aliases];
    session.updatedAt = nowIso();
    if (newSession && newSession !== session) {
      session.messages = [...newSession.messages, ...session.messages]
        .filter((msg, idx, arr) => arr.findIndex((other) => other.id === msg.id) === idx);
      const newCreatedAt = newSession.createdAt || session.createdAt || nowIso();
      const oldCreatedAt = session.createdAt || newCreatedAt;
      session.createdAt = newCreatedAt < oldCreatedAt ? newCreatedAt : oldCreatedAt;
      delete store.sessions[canonicalNew];
    }
    delete store.sessions[canonicalOld];
    store.sessions[nextId] = session;
    store.aliases[oldId] = nextId;
    store.aliases[canonicalOld] = nextId;
  });
}

export function recordProjectedRunEvent(input: RecordProjectedRunEventInput): void {
  const profile = normalizeProfile(input.profileId);
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;
  const innerType = input.type || 'api.event';
  const payload = safeRecord(input.payload) || {};
  const item = safeRecord(payload.item) || {};
  if (!isProjectableRunEvent(innerType, payload, item)) return;
  mutateStore((store) => {
    const canonicalId = resolveAlias(store, sessionId);
    const session = store.sessions[canonicalId];
    if (!session) return false;
    if (session.profileId !== profile) {
      throw new SessionProfileRoutingError(SESSION_PROFILE_MISMATCH, 'Projected session belongs to a different profile.', 403);
    }
    assertCanWriteProjectedSession(session, input.viewer);
    const now = nowIso();
    let changed = false;

    if (innerType === 'response.output_item.added' && isFunctionCallItemType(item.type)) {
      const ids = toolCallIds(item, `tc_${Date.now()}`);
      const fn = safeRecord(item.function);
      const name = stringValue(item.name) || stringValue(fn?.name) || 'tool';
      const args = typeof item.arguments === 'string' ? item.arguments.slice(0, 200_000) : '';
      changed = upsertToolCallMessage(session, {
        primary: ids.primary,
        itemId: ids.itemId || undefined,
        callId: ids.callId || undefined,
        name,
        args,
        now,
      });
    } else if (isToolArgsDone(innerType)) {
      const itemId = String((payload.item_id as string) || (item.id as string) || '');
      const args = typeof payload.arguments === 'string'
        ? payload.arguments
        : (typeof item.arguments === 'string' ? item.arguments : '');
      if (itemId && args) {
        const slot = getProjectedToolSlot(session, itemId);
        const name = stringValue(payload.name) || stringValue(item.name) || slot?.name || 'tool';
        changed = upsertToolCallMessage(session, {
          primary: itemId,
          itemId: slot?.itemId || itemId,
          callId: slot?.callId,
          name,
          args: args.slice(0, 200_000),
          now,
        });
      }
    } else if (innerType === 'response.output_item.done') {
      if (isFunctionCallItemType(item.type) && typeof item.arguments === 'string') {
        const ids = toolCallIds(item);
        const slot = getProjectedToolSlot(session, ids.primary) || getProjectedToolSlot(session, ids.itemId) || getProjectedToolSlot(session, ids.callId);
        const name = stringValue(item.name) || slot?.name || 'tool';
        changed = upsertToolCallMessage(session, {
          primary: ids.primary,
          itemId: ids.itemId || slot?.itemId,
          callId: ids.callId || slot?.callId,
          name,
          args: item.arguments.slice(0, 200_000),
          now,
        });
      }
      const itype = String(item.type || '');
      if (itype === 'tool_result' || itype === 'function_call_output' || itype === 'tool_output') {
        const itemId = String((item.call_id as string) || (item.tool_call_id as string) || (item.id as string) || '');
        const slot = getProjectedToolSlot(session, itemId);
        const output = item.output ?? item.content;
        if (itemId && output != null) {
          changed = insertToolResultMessage(session, {
            itemId,
            toolName: slot?.name || stringValue(item.name) || 'tool',
            content: normalizeToolOutput(output),
            now,
          }) || changed;
        }
      }
    } else if (isToolResultEvent(innerType)) {
      const itemId = String(
        (payload.item_id as string)
        || (payload.tool_call_id as string)
        || (payload.call_id as string)
        || (item.id as string)
        || ''
      );
      const slot = getProjectedToolSlot(session, itemId);
      const output = payload.output ?? payload.result ?? payload.content;
      if (itemId && output != null) {
        changed = insertToolResultMessage(session, {
          itemId,
          toolName: slot?.name || stringValue(payload.tool_name) || stringValue(item.name) || 'tool',
          content: normalizeToolOutput(output),
          now,
        });
      }
    }

    if (changed) {
      session.status = 'running';
      session.updatedAt = now;
      session.messageCount = session.messages.length;
    }
    return changed || false;
  });
}

export function finalizeProjectedTurn(input: FinalizeProjectedTurnInput): void {
  const profile = normalizeProfile(input.profileId);
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;
  const content = sanitizeText(input.content);
  const attachments = sanitizeAttachments(input.attachments);
  mutateStore((store) => {
    const canonicalId = resolveAlias(store, sessionId);
    const session = store.sessions[canonicalId];
    if (!session) return;
    if (session.profileId !== profile) {
      throw new SessionProfileRoutingError(SESSION_PROFILE_MISMATCH, 'Projected session belongs to a different profile.', 403);
    }
    assertCanWriteProjectedSession(session, input.viewer);
    const now = nowIso();
    const draft = findAssistantDraft(session);
    if (draft) {
      draft.content = content;
      draft.updatedAt = now;
      draft.attachments = attachments || draft.attachments;
      draft.metadata = { ...(draft.metadata || {}), projectionStatus: 'final', responseId: input.responseId };
    } else {
      session.messages.push({
        id: messageId('a'),
        role: 'assistant',
        content,
        createdAt: now,
        attachments,
        metadata: { observedFrom: 'deck-stream', projectionStatus: 'final', responseId: input.responseId },
      });
    }
    session.responseId = input.responseId || session.responseId;
    session.model = input.model || session.model;
    session.reasoningEffort = input.reasoningEffort || session.reasoningEffort;
    session.status = 'completed';
    session.updatedAt = now;
    session.messageCount = session.messages.length;
  });
}

export function recordProjectedTurnError(input: RecordProjectedErrorInput): void {
  const profile = normalizeProfile(input.profileId);
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;
  const safeError = sanitizeText(input.detail || input.error, 1000);
  mutateStore((store) => {
    const canonicalId = resolveAlias(store, sessionId);
    const session = store.sessions[canonicalId];
    if (!session) return;
    if (session.profileId !== profile) {
      throw new SessionProfileRoutingError(SESSION_PROFILE_MISMATCH, 'Projected session belongs to a different profile.', 403);
    }
    assertCanWriteProjectedSession(session, input.viewer);
    const now = nowIso();
    const draft = findAssistantDraft(session);
    const content = safeError ? `Error: ${safeError}` : 'Error: chat stream failed.';
    if (draft) {
      draft.content = content;
      draft.updatedAt = now;
      draft.metadata = { ...(draft.metadata || {}), projectionStatus: 'error', error: input.error };
    } else {
      session.messages.push({
        id: messageId('a'),
        role: 'assistant',
        content,
        createdAt: now,
        metadata: { observedFrom: 'deck-stream', projectionStatus: 'error', error: input.error },
      });
    }
    session.lastError = safeError;
    session.status = 'failed';
    session.updatedAt = now;
    session.messageCount = session.messages.length;
  });
}

export function listProjectedSessions(profileId: string, viewer?: ProjectionViewer): DeckSession[] {
  const profile = normalizeProfile(profileId);
  const store = readStore();
  return Object.values(store.sessions)
    .filter((session) => session.profileId === profile)
    .filter((session) => canViewProjectedSession(session, viewer))
    .map(sessionSummary)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export function getProjectedMessages(sessionId: string, profileId: string, opts: { limit?: number; before?: string; viewer?: ProjectionViewer } = {}): DeckMessage[] | null {
  const store = readStore();
  const canonicalId = resolveAlias(store, sessionId.trim());
  const session = store.sessions[canonicalId];
  if (!session) return null;
  const profile = normalizeProfile(profileId);
  if (session.profileId !== profile) {
    throw new SessionProfileRoutingError(
      SESSION_PROFILE_MISMATCH,
      'Session does not belong to the requested profile.',
      403,
    );
  }
  if (!canViewProjectedSession(session, opts.viewer)) {
    throw new SessionProfileRoutingError(
      SESSION_PROFILE_MISMATCH,
      'Session does not belong to the authenticated user.',
      403,
    );
  }
  let messages = session.messages.map((message): DeckMessage => ({ ...message }));
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
  const limit = Number.isFinite(opts.limit) && opts.limit && opts.limit > 0
    ? Math.min(1000, Math.max(1, Math.trunc(opts.limit)))
    : undefined;
  if (limit && messages.length > limit) messages = messages.slice(-limit);
  return messages;
}

export function importProjectedChatState(input: ImportProjectedChatStateInput): { imported: number } {
  const profileId = normalizeProfile(input.profileId);
  const sessionsInput = Array.isArray(input.sessions) ? input.sessions.slice(0, MAX_IMPORTED_SESSIONS) : [];
  const messagesInput = safeRecord(input.messages) || {};
  const responseIds = safeRecord(input.responseIds) || {};
  let imported = 0;
  mutateStore((store) => {
    const now = nowIso();
    for (const rawSession of sessionsInput) {
      const rec = safeRecord(rawSession);
      if (!rec) continue;
      const id = stringValue(rec.id);
      if (!id) continue;
      const rowProfile = stringValue(rec.profileId) || profileId;
      if (rowProfile !== profileId) continue;
      const rawMessages = Array.isArray(messagesInput[id]) ? (messagesInput[id] as unknown[]).slice(0, MAX_MESSAGES_PER_SESSION) : [];
      const messages = rawMessages
        .map((message, idx) => sanitizeMessage(message, `${id}_${idx}`))
        .filter((message): message is ProjectedMessage => message !== null);
      if (!messages.length) continue;
      const existing = store.sessions[id];
      if (existing && existing.profileId !== profileId) continue;
      const createdAt = isoTimestamp(rec.createdAt) || messages[0]?.createdAt || now;
      const updatedAt = isoTimestamp(rec.updatedAt) || messages[messages.length - 1]?.createdAt || createdAt;
      const responseId = stringValue(responseIds[id]);
      store.sessions[id] = {
        ...existing,
        id,
        profileId,
        title: stringValue(rec.title) || previewTitle(messages.find((m) => m.role === 'user')?.content || '', id),
        source: stringValue(rec.source) || 'hermesdeck',
        model: stringValue(rec.model) || existing?.model,
        createdAt,
        updatedAt,
        messageCount: messages.length,
        pinned: typeof rec.pinned === 'boolean' ? rec.pinned : existing?.pinned,
        folderId: stringValue(rec.folderId) || existing?.folderId,
        parentSessionId: stringValue(rec.parentSessionId) || existing?.parentSessionId,
        childCount: typeof rec.childCount === 'number' ? Math.max(0, Math.trunc(rec.childCount)) : existing?.childCount,
        ownerUserId: input.ownerUserId,
        ownerRole: input.ownerRole,
        status: existing?.status || 'completed',
        responseId: responseId || existing?.responseId,
        messages,
      };
      imported += 1;
    }
  });
  return { imported };
}

export function hasProjectedSession(sessionId: string, profileId: string, viewer?: ProjectionViewer): boolean {
  const store = readStore();
  const canonicalId = resolveAlias(store, sessionId.trim());
  const session = store.sessions[canonicalId];
  return !!session && session.profileId === normalizeProfile(profileId) && canWriteProjectedSession(session, viewer);
}

export function projectedResponseIdMatches(sessionId: string, profileId: string, responseId: string, viewer?: ProjectionViewer): boolean {
  const expected = responseId.trim();
  if (!expected) return false;
  const store = readStore();
  const canonicalId = resolveAlias(store, sessionId.trim());
  const session = store.sessions[canonicalId];
  if (!session || session.profileId !== normalizeProfile(profileId) || !canWriteProjectedSession(session, viewer)) return false;
  if (session.responseId === expected) return true;
  return session.messages.some((message) => {
    const metadata = safeRecord(message.metadata);
    return stringValue(metadata?.responseId) === expected;
  });
}

export function noProjectedSessionError(): SessionProfileRoutingError {
  return new SessionProfileRoutingError(
    PROFILE_ROUTING_UNAVAILABLE,
    'HermesDeck has no profile-scoped projection for this session, and Hermes Agent did not provide trusted profile metadata.',
    502,
  );
}
