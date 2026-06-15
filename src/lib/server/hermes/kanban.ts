import type {
  KanbanBoard,
  KanbanBoardSnapshot,
  KanbanTaskDetail,
  KanbanDiagnostic,
  KanbanStats,
  KanbanAssignee,
  KanbanMarkdownListResult,
  KanbanMarkdownFile,
} from '@/lib/types';
import { apiHeaders, HERMES_API_BASE, redactSecrets } from './core';

// API-only Kanban adapter. HermesDeck must not reconstruct kanban state from
// ~/.hermes, SQLite, or the Hermes CLI; unavailable upstream endpoints are
// surfaced as explicit Hermes Agent API failures and Deck routes convert them
// to service errors.

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_SEVERITIES = new Set(['warning', 'error', 'critical']);

function safeBoard(board: string | undefined | null): string {
  if (!board) return 'default';
  return BOARD_SLUG_RE.test(board) ? board : 'default';
}

function assertTaskId(id: string): void {
  if (!TASK_ID_RE.test(id)) throw new Error('invalid_task_id');
}

function apiUrl(path: string): string {
  const base = HERMES_API_BASE.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? `: ${redactSecrets(text).slice(0, 240)}` : '';
}

async function kanbanApi<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 8000, headers, ...fetchInit } = init ?? {};
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    ...fetchInit,
    headers: { ...apiHeaders(), ...(headers || {}) },
    signal: fetchInit.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Hermes Agent API ${fetchInit.method || 'GET'} ${path} failed with ${response.status}${await readApiError(response)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text().catch(() => '');
  return (text ? JSON.parse(text) : undefined) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') s.set(key, String(value));
  }
  const out = s.toString();
  return out ? `?${out}` : '';
}

function unwrapArray<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const nested = (value as Record<string, unknown> | null)?.[key];
  if (Array.isArray(nested)) return nested as T[];
  throw new Error(`Hermes Agent API response missing ${key} array`);
}

export async function getBoards(): Promise<KanbanBoard[]> {
  const payload = await kanbanApi<KanbanBoard[] | { boards: KanbanBoard[] }>('/api/kanban/boards');
  return unwrapArray<KanbanBoard>(payload, 'boards');
}

export async function getBoardSnapshot(boardSlug: string): Promise<KanbanBoardSnapshot> {
  const board = safeBoard(boardSlug);
  return kanbanApi<KanbanBoardSnapshot>(`/api/kanban${qs({ board })}`);
}

export async function getTaskDetail(boardSlug: string, taskId: string): Promise<KanbanTaskDetail | null> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  const payload = await kanbanApi<KanbanTaskDetail | { task: KanbanTaskDetail | null }>(`/api/kanban/${encodeURIComponent(taskId)}${qs({ board })}`);
  if (payload && typeof payload === 'object' && 'task' in payload) return (payload as { task: KanbanTaskDetail | null }).task;
  return payload as KanbanTaskDetail | null;
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  workspaceKind?: 'scratch' | 'worktree' | 'session';
  workspacePath?: string;
  tenant?: string;
  parents?: string[];
  skills?: string[];
}

export async function createTask(boardSlug: string, input: CreateTaskInput): Promise<{ id: string }> {
  const board = safeBoard(boardSlug);
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title_required');
  if (title.length > 200) throw new Error('title_too_long');
  return kanbanApi<{ id: string }>(`/api/kanban${qs({ board })}`, {
    method: 'POST',
    body: JSON.stringify({ ...input, title }),
    timeoutMs: 15_000,
  });
}

export type TaskAction = 'block' | 'unblock' | 'complete' | 'archive' | 'reclaim';

export async function applyTaskAction(boardSlug: string, taskId: string, action: TaskAction, opts?: { reason?: string; summary?: string }): Promise<void> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(taskId)}${qs({ board })}`, {
    method: 'PATCH',
    body: JSON.stringify({ op: action, ...opts }),
    timeoutMs: 15_000,
  });
}

export async function assignTask(boardSlug: string, taskId: string, profile: string | null): Promise<void> {
  if (profile && !/^[\w.-]{1,64}$/.test(profile)) throw new Error('invalid_profile');
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(taskId)}${qs({ board })}`, {
    method: 'PATCH',
    body: JSON.stringify({ op: 'assign', profile }),
    timeoutMs: 15_000,
  });
}

export async function commentTask(boardSlug: string, taskId: string, body: string, author?: string): Promise<void> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('comment_body_required');
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(taskId)}${qs({ board })}`, {
    method: 'PATCH',
    body: JSON.stringify({ op: 'comment', body: trimmed, author }),
    timeoutMs: 15_000,
  });
}

export async function setActiveBoard(boardSlug: string): Promise<void> {
  const board = safeBoard(boardSlug);
  await kanbanApi<void>(`/api/kanban/boards/active`, {
    method: 'PUT',
    body: JSON.stringify({ board }),
    timeoutMs: 15_000,
  });
}

export async function getTaskLog(boardSlug: string, taskId: string, tail?: number): Promise<{ log: string; truncated: boolean }> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  const payload = await kanbanApi<{ log: string; truncated: boolean }>(`/api/kanban/${encodeURIComponent(taskId)}/log${qs({ board, tail })}`, { timeoutMs: 30_000 });
  return { log: payload.log || '', truncated: !!payload.truncated };
}

export async function linkTasks(boardSlug: string, parentId: string, childId: string): Promise<void> {
  const board = safeBoard(boardSlug);
  assertTaskId(parentId);
  assertTaskId(childId);
  if (parentId === childId) throw new Error('cannot_link_self');
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(parentId)}/links${qs({ board })}`, {
    method: 'POST',
    body: JSON.stringify({ childId }),
    timeoutMs: 15_000,
  });
}

export async function unlinkTasks(boardSlug: string, parentId: string, childId: string): Promise<void> {
  const board = safeBoard(boardSlug);
  assertTaskId(parentId);
  assertTaskId(childId);
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(parentId)}/links/${encodeURIComponent(childId)}${qs({ board })}`, {
    method: 'DELETE',
    timeoutMs: 15_000,
  });
}

export async function getDiagnostics(boardSlug: string, opts?: { severity?: string; taskId?: string }): Promise<KanbanDiagnostic[]> {
  const board = safeBoard(boardSlug);
  if (opts?.taskId) assertTaskId(opts.taskId);
  const severity = opts?.severity && VALID_SEVERITIES.has(opts.severity) ? opts.severity : undefined;
  const payload = await kanbanApi<KanbanDiagnostic[] | { diagnostics: KanbanDiagnostic[] }>(`/api/kanban/diagnostics${qs({ board, severity, taskId: opts?.taskId })}`);
  return unwrapArray<KanbanDiagnostic>(payload, 'diagnostics');
}

export interface WatchHandle {
  stream: ReadableStream<Uint8Array>;
  close: () => void;
}

export function watchBoardEvents(boardSlug: string, opts?: { lastId?: number; intervalSec?: number; signal?: AbortSignal }): WatchHandle {
  const board = safeBoard(boardSlug);
  const controller = new AbortController();
  const close = () => controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) close();
    else opts.signal.addEventListener('abort', close, { once: true });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      try {
        const path = `/api/kanban/events${qs({ board, lastId: Math.max(0, Math.floor(opts?.lastId || 0)), intervalSec: opts?.intervalSec })}`;
        const response = await fetch(apiUrl(path), {
          cache: 'no-store',
          headers: apiHeaders(),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const detail = !response.ok ? await readApiError(response) : ': missing response stream';
          throw new Error(`Hermes Agent API GET ${path} failed with ${response.status}${detail}`);
        }
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) out.enqueue(value);
          }
        } finally {
          reader.releaseLock();
        }
        out.close();
      } catch (err) {
        if (!controller.signal.aborted) {
          const detail = err instanceof Error ? err.message : String(err);
          try { out.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ detail: detail.slice(0, 240) })}\n\n`)); } catch {}
        }
        try { out.close(); } catch {}
      }
    },
    cancel() { close(); },
  });
  return { stream, close };
}

export async function getStats(boardSlug: string): Promise<KanbanStats> {
  const board = safeBoard(boardSlug);
  return kanbanApi<KanbanStats>(`/api/kanban/stats${qs({ board })}`);
}

export async function getAssignees(boardSlug: string): Promise<KanbanAssignee[]> {
  const board = safeBoard(boardSlug);
  const payload = await kanbanApi<KanbanAssignee[] | { assignees: KanbanAssignee[] }>(`/api/kanban/assignees${qs({ board })}`);
  return unwrapArray<KanbanAssignee>(payload, 'assignees');
}

export async function getTaskContext(boardSlug: string, taskId: string): Promise<{ context: string }> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  return kanbanApi<{ context: string }>(`/api/kanban/${encodeURIComponent(taskId)}/context${qs({ board })}`, { timeoutMs: 30_000 });
}

export interface EditTaskInput {
  result: string;
  summary?: string;
  metadata?: unknown;
}

export async function editTask(boardSlug: string, taskId: string, input: EditTaskInput): Promise<void> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  const result = String(input.result || '').trim();
  if (!result) throw new Error('result_required');
  await kanbanApi<void>(`/api/kanban/${encodeURIComponent(taskId)}${qs({ board })}`, {
    method: 'PATCH',
    body: JSON.stringify({ op: 'edit', ...input, result }),
    timeoutMs: 15_000,
  });
}

export async function listMarkdownFiles(boardSlug: string, taskId: string): Promise<KanbanMarkdownListResult> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  return kanbanApi<KanbanMarkdownListResult>(`/api/kanban/${encodeURIComponent(taskId)}/markdown${qs({ board })}`);
}

export async function readMarkdownFile(boardSlug: string, taskId: string, relPath: string): Promise<KanbanMarkdownFile> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  return kanbanApi<KanbanMarkdownFile>(`/api/kanban/${encodeURIComponent(taskId)}/markdown/file${qs({ board, path: relPath })}`);
}

export async function writeMarkdownFile(boardSlug: string, taskId: string, relPath: string, content: string, mtime?: number): Promise<{ ok: true; path: string; size: number; mtime: number }> {
  const board = safeBoard(boardSlug);
  assertTaskId(taskId);
  return kanbanApi<{ ok: true; path: string; size: number; mtime: number }>(`/api/kanban/${encodeURIComponent(taskId)}/markdown/file${qs({ board, path: relPath })}`, {
    method: 'PUT',
    body: JSON.stringify({ content, mtime }),
    timeoutMs: 15_000,
  });
}
