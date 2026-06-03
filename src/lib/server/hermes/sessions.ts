import type { DeckSession } from '@/lib/types';
import { hermesApiGet, PROFILE_ID_RE } from './core';

const PAGE_LIMIT = 200;
const SESSION_LIST_MAX = 1000;
const STATS_LIST_MAX = 10_000;

interface HermesSessionRow {
  id?: unknown;
  session_id?: unknown;
  profile?: unknown;
  profile_id?: unknown;
  source?: unknown;
  model?: unknown;
  title?: unknown;
  preview?: unknown;
  started_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  ended_at?: unknown;
  last_active?: unknown;
  message_count?: unknown;
  parent_session_id?: unknown;
  child_count?: unknown;
  pinned?: unknown;
  folder_id?: unknown;
}

interface HermesSessionsResponse {
  object?: unknown;
  data?: unknown;
  sessions?: unknown;
  limit?: unknown;
  offset?: unknown;
  has_more?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = numberValue(value);
    if (numeric !== undefined) return isoTimestamp(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function titleFor(row: HermesSessionRow, id: string): string {
  const explicit = stringValue(row.title);
  if (explicit) return explicit;
  const preview = stringValue(row.preview);
  if (preview) return preview.length > 80 ? `${preview.slice(0, 77)}…` : preview;
  return id;
}

function normalizeSession(row: HermesSessionRow, requestedProfile?: string): DeckSession | null {
  const id = stringValue(row.id) || stringValue(row.session_id);
  if (!id) return null;
  const profileId = stringValue(row.profile_id) || stringValue(row.profile) || requestedProfile || 'default';
  const createdAt = isoTimestamp(row.started_at ?? row.created_at);
  const updatedAt = isoTimestamp(row.last_active ?? row.updated_at ?? row.ended_at ?? row.started_at ?? row.created_at);
  const messageCount = numberValue(row.message_count);
  const childCount = numberValue(row.child_count);
  return {
    id,
    profileId,
    title: titleFor(row, id),
    source: stringValue(row.source) || 'api',
    model: stringValue(row.model),
    createdAt,
    updatedAt,
    messageCount: messageCount === undefined ? undefined : Math.max(0, Math.trunc(messageCount)),
    pinned: typeof row.pinned === 'boolean' ? row.pinned : undefined,
    folderId: stringValue(row.folder_id),
    parentSessionId: stringValue(row.parent_session_id),
    childCount: childCount === undefined ? undefined : Math.max(0, Math.trunc(childCount)),
  };
}

function validateProfile(profile?: string): string | undefined {
  const normalized = profile?.trim() || undefined;
  if (normalized && !PROFILE_ID_RE.test(normalized)) throw new Error(`Invalid Hermes profile id: ${normalized}`);
  return normalized;
}

async function fetchSessionPage(profile: string | undefined, limit: number, offset: number): Promise<{ sessions: DeckSession[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (profile) params.set('profile', profile);
  const payload = await hermesApiGet<HermesSessionsResponse | HermesSessionRow[]>(`/api/sessions?${params.toString()}`, 8000);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.sessions)
        ? payload.sessions
        : [];
  const sessions = rows
    .filter(isRecord)
    .map((row) => normalizeSession(row as HermesSessionRow, profile))
    .filter((session): session is DeckSession => session !== null);
  const hasMore = !Array.isArray(payload) && payload.has_more === true;
  return { sessions, hasMore };
}

async function fetchSessions(profile: string | undefined, maxSessions: number): Promise<DeckSession[]> {
  const scopedProfile = validateProfile(profile);
  const all: DeckSession[] = [];
  for (let offset = 0; all.length < maxSessions; offset += PAGE_LIMIT) {
    const page = await fetchSessionPage(scopedProfile, Math.min(PAGE_LIMIT, maxSessions - all.length), offset);
    all.push(...page.sessions);
    if (!page.hasMore || page.sessions.length === 0) break;
  }
  return all;
}

export async function getSessions(profile = 'default'): Promise<DeckSession[]> {
  return fetchSessions(profile, SESSION_LIST_MAX);
}

export async function getSessionsForStats(profile?: string): Promise<DeckSession[]> {
  return fetchSessions(profile, STATS_LIST_MAX);
}

export async function tagSessionSource(_sessionId: string, _source: string, _profile = 'default'): Promise<void> {
  // Best-effort local tagging used to touch Hermes runtime storage directly.
  // It is now intentionally disabled; chat uses the Hermes Agent API as source of truth.
  return;
}

export async function deleteSession(_sessionId: string, _profile = 'default'): Promise<{ ok: boolean; removed: number }> {
  throw new Error('deleteSession: Hermes Agent API does not currently expose session deletion. Direct local database mutation is disabled.');
}
