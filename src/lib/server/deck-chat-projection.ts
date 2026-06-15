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
import type { DeckAttachment, DeckMessage, DeckSession, DeckStats } from '@/lib/types';
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
  previousResponseId?: string;
};

export type FinalizeProjectedTurnInput = {
  sessionId: string;
  profileId: string;
  content?: string;
  responseId?: string;
  attachments?: unknown;
};

export type RecordProjectedErrorInput = {
  sessionId: string;
  profileId: string;
  error: string;
  detail?: string;
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

function mutateStore<T>(fn: (store: ProjectionStore) => T): T {
  return withStoreLock(() => {
    const store = readStore();
    const result = fn(store);
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
    session.ownerUserId ||= input.ownerUserId;
    session.ownerRole ||= input.ownerRole;
    session.model = input.model || session.model;
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

export function reconcileProjectedSessionId(oldSessionId: string, newSessionId: string, profileId: string): void {
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

export function listProjectedSessions(profileId: string): DeckSession[] {
  const profile = normalizeProfile(profileId);
  const store = readStore();
  return Object.values(store.sessions)
    .filter((session) => session.profileId === profile)
    .map(sessionSummary)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export function getProjectedMessages(sessionId: string, profileId: string, opts: { limit?: number; before?: string } = {}): DeckMessage[] | null {
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

export function getProjectedStats(profileId: string): DeckStats {
  const sessions = listProjectedSessions(profileId);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const since = Date.now() - DAY_MS;
  let totalMessages = 0;
  let activeSessions24h = 0;
  let activeMessages24h = 0;
  let lastActiveAt: string | undefined;
  const perSource = new Map<string, number>();
  for (const session of sessions) {
    const messages = Math.max(0, Math.trunc(session.messageCount || 0));
    totalMessages += messages;
    const activeAt = session.updatedAt || session.createdAt;
    if (activeAt && (!lastActiveAt || activeAt > lastActiveAt)) lastActiveAt = activeAt;
    const createdMs = session.createdAt ? new Date(session.createdAt).getTime() : NaN;
    if (Number.isFinite(createdMs) && createdMs >= since) activeSessions24h += 1;
    const activeMs = activeAt ? new Date(activeAt).getTime() : NaN;
    if (Number.isFinite(activeMs) && activeMs >= since) activeMessages24h += messages;
    const source = session.source || 'hermesdeck';
    perSource.set(source, (perSource.get(source) || 0) + 1);
  }
  return {
    scope: profileId,
    totalSessions: sessions.length,
    totalMessages,
    activeSessions24h,
    activeMessages24h,
    perProfile: [{ profileId, sessions: sessions.length, messages: totalMessages, lastActiveAt }],
    perSource: [...perSource.entries()].map(([source, count]) => ({ source, sessions: count })),
    lastActiveAt,
  };
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

export function hasProjectedSession(sessionId: string, profileId: string): boolean {
  const store = readStore();
  const canonicalId = resolveAlias(store, sessionId.trim());
  const session = store.sessions[canonicalId];
  return !!session && session.profileId === normalizeProfile(profileId);
}

export function projectedResponseIdMatches(sessionId: string, profileId: string, responseId: string): boolean {
  const expected = responseId.trim();
  if (!expected) return false;
  const store = readStore();
  const canonicalId = resolveAlias(store, sessionId.trim());
  const session = store.sessions[canonicalId];
  if (!session || session.profileId !== normalizeProfile(profileId)) return false;
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
