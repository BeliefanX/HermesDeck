import type { DeckAuthSession, DeckHealth, DeckProfile, DeckSession, DeckMessage, ToolSummary, TerminalAction, TerminalRunRequest, TerminalRunResult, DeckModelsResponse, DeckModelPreferenceResponse, DeckNotificationConfigResponse, DeckNotificationPreferences, TokenStats, DeckStats, DeckRun, DeckRunDetail, DeckCronJob, LiveTerminalSession, LiveTerminalListResponse, LiveTerminalWindow, LiveTerminalCreateRequest, LiveTerminalTmuxRequest, SkillContent, KanbanBoard, KanbanBoardSnapshot, KanbanTaskDetail, KanbanDiagnostic, KanbanStats, KanbanAssignee, KanbanTaskLog, KanbanTaskContext, KanbanMarkdownListResult, KanbanMarkdownFile, LcmDashboard } from './types';
import type { ConfigFileKey, DeckConfigBundle, SaveConfigResult } from './config-files';

/**
 * Thrown when the service worker returned its synthetic offline response
 * (status 503, body `{ ok:false, offline:true }`).
 */
export class OfflineError extends Error {
  readonly offline = true;
  constructor() { super('offline'); this.name = 'OfflineError'; }
}

/**
 * Structured API error with the response status, the parsed (or raw) body,
 * and a short human-readable message. Callers can branch on `err.status` to
 * surface a useful UI state instead of dumping a stringified stack trace.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed: ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

function isHtmlResponse(contentType: string | null, text: string): boolean {
  const type = (contentType || '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml+xml')) return true;
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text);
}

function titleFromHtml(text: string): string | undefined {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  return match[1]
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
    .slice(0, 120) || undefined;
}

function messageForErrorResponse(res: Response, parsedBody: unknown, text: string): string {
  if (parsedBody && typeof parsedBody === 'object' && parsedBody !== null) {
    const body = parsedBody as { error?: unknown; detail?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      const detail = typeof body.detail === 'string' && body.detail.trim() ? `: ${body.detail.trim()}` : '';
      return `${body.error.trim()}${detail}`;
    }
  }
  if (isHtmlResponse(res.headers.get('content-type'), text)) {
    const title = titleFromHtml(text);
    return title
      ? `HTTP ${res.status}: upstream returned an HTML error page (${title})`
      : `HTTP ${res.status}: upstream returned an HTML error page`;
  }
  return text ? text.slice(0, 500) : `Request failed: ${res.status}`;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && (timeoutMs as number) > 0 ? (timeoutMs as number) : DEFAULT_TIMEOUT_MS;
}

function combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(normalizeTimeoutMs(timeoutMs));
  const signals = callerSignal ? [callerSignal, timeoutSignal] : [timeoutSignal];
  if (signals.length === 1) return signals[0]!;
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(signals);
  // Fallback for older runtimes (browsers without AbortSignal.any).
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ctrl.abort((s as AbortSignal & { reason?: unknown }).reason); break; }
    s.addEventListener('abort', () => ctrl.abort((s as AbortSignal & { reason?: unknown }).reason), { once: true });
  }
  return ctrl.signal;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, signal: callerSignal, headers, ...fetchInit } = init ?? {};
  const signal = combineSignals(callerSignal ?? undefined, timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...fetchInit,
      signal,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    });
  } catch (err) {
    // Re-throw AbortError unchanged so callers can distinguish a deliberate
    // cancel from a genuine offline drop or a timeout.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new OfflineError();
  }
  if (res.status === 503) {
    try {
      const body = await res.clone().json();
      if (body && body.offline === true) throw new OfflineError();
    } catch (e) {
      if (e instanceof OfflineError) throw e;
    }
  }
  if (!res.ok) {
    let parsedBody: unknown = undefined;
    let text = '';
    try { text = await res.text(); } catch {}
    if (text) {
      try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
    }
    const msg = messageForErrorResponse(res, parsedBody, text);
    throw new ApiError(res.status, parsedBody, msg);
  }
  return res.json();
}

export const deckApi = {
  session: (signal?: AbortSignal) => request<DeckAuthSession>('/api/deck/auth/session', { signal }),
  health: (signal?: AbortSignal) => request<DeckHealth>('/api/deck/health', { signal }),
  stats: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<DeckStats>(`/api/deck/stats${qs}`, { signal });
  },
  profiles: (signal?: AbortSignal) => request<{ profiles: DeckProfile[]; error?: string; detail?: string }>('/api/deck/profiles', { signal }),
  sessions: (profileId = 'default', signal?: AbortSignal) =>
    request<{ sessions: DeckSession[] }>(`/api/deck/sessions?profile=${encodeURIComponent(profileId)}`, { signal }),
  messages: (sessionId: string, profileId = 'default', signal?: AbortSignal) =>
    request<{ messages: DeckMessage[] }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(profileId)}`, { signal }),
  deleteSession: (sessionId: string, profileId = 'default') =>
    request<{ ok: boolean; removed: number }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profileId)}`, { method: 'DELETE' }),
  tools: (signal?: AbortSignal) => request<{ tools: ToolSummary[] }>('/api/deck/tools', { signal }),
  lcm: (signal?: AbortSignal) => request<LcmDashboard>('/api/deck/lcm', { signal, timeoutMs: 30_000 }),
  skillRead: (relPath: string, signal?: AbortSignal) =>
    request<SkillContent>(`/api/deck/skills?path=${encodeURIComponent(relPath)}`, { signal }),
  skillSave: (relPath: string, content: string, mtime?: string) =>
    request<{ ok: true; mtime: string; size: number }>('/api/deck/skills', {
      method: 'PUT',
      body: JSON.stringify({ relPath, content, mtime }),
      timeoutMs: 15_000,
    }),
  // Per-profile Hermes config files (config.yaml / SOUL.md / USER.md / MEMORY.md).
  config: (profileId = 'default', signal?: AbortSignal) =>
    request<DeckConfigBundle>(`/api/deck/config?profile=${encodeURIComponent(profileId)}`, { signal }),
  configSave: (profileId: string, file: ConfigFileKey, content: string, mtime?: string) =>
    request<SaveConfigResult>(`/api/deck/config?profile=${encodeURIComponent(profileId)}`, {
      method: 'PUT',
      body: JSON.stringify({ file, content, mtime }),
      timeoutMs: 15_000,
    }),
  models: (profileId = 'default', signal?: AbortSignal) =>
    request<DeckModelsResponse>(`/api/deck/models?profile=${encodeURIComponent(profileId)}`, { signal }),
  modelPreference: (profileId = 'default', signal?: AbortSignal) =>
    request<DeckModelPreferenceResponse>(`/api/deck/model-preferences?profileId=${encodeURIComponent(profileId)}`, { signal }),
  saveModelPreference: (profileId: string, body: { modelId?: string; modelProvider?: string }) =>
    request<DeckModelPreferenceResponse>('/api/deck/model-preferences', {
      method: 'PUT',
      body: JSON.stringify({ profileId, ...body }),
    }),
  notificationConfig: (signal?: AbortSignal) => request<DeckNotificationConfigResponse>('/api/deck/notifications/config', { signal }),
  saveNotificationPreferences: (body: Partial<DeckNotificationPreferences>) =>
    request<{ ok: true; preferences: DeckNotificationPreferences }>('/api/deck/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  savePushSubscription: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true; subscriptionCount: number }>('/api/deck/notifications/subscription', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  deletePushSubscription: (endpoint: string) =>
    request<{ ok: true; subscriptionCount: number }>('/api/deck/notifications/subscription', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
  sendTestNotification: (profileId = 'default', sessionId?: string) =>
    request<{ ok: true; sent: number; unavailable?: boolean }>('/api/deck/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ profileId, sessionId }),
    }),
  // Token aggregation can be slow when state.db is large; bump the timeout.
  tokens: (days = 14, signal?: AbortSignal, profileId?: string) => {
    const params = new URLSearchParams({ days: String(days) });
    if (profileId) params.set('profile', profileId);
    return request<TokenStats>(`/api/deck/tokens?${params.toString()}`, { signal, timeoutMs: 30_000 });
  },
  runs: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<{ runs: DeckRun[]; unavailableReason?: string }>(`/api/deck/runs${qs}`, { signal, timeoutMs: 30_000 });
  },
  cronJobs: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<{ jobs: DeckCronJob[] }>(`/api/deck/cron${qs}`, { signal, timeoutMs: 30_000 });
  },
  runDetail: (id: string, signal?: AbortSignal) => request<DeckRunDetail>(`/api/deck/runs/${encodeURIComponent(id)}`, { signal }),
  terminalActions: (signal?: AbortSignal) => request<{ actions: TerminalAction[] }>('/api/deck/terminal/actions', { signal }),
  terminalRun: (body: TerminalRunRequest) => request<TerminalRunResult>('/api/deck/terminal/run', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60_000 }),

  liveList: () => request<LiveTerminalListResponse>('/api/deck/term/sessions'),
  liveCreate: (body: LiveTerminalCreateRequest = {}) => request<{ session: LiveTerminalSession }>('/api/deck/term/sessions', { method: 'POST', body: JSON.stringify(body) }),
  liveKill: (id: string) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  liveInput: (id: string, data: string) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/input`, { method: 'POST', body: JSON.stringify({ data }) }),
  liveResize: (id: string, cols: number, rows: number) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  liveWindows: (id: string) => request<{ windows: LiveTerminalWindow[] }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/windows`),
  liveTmux: (id: string, body: LiveTerminalTmuxRequest) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/tmux`, { method: 'POST', body: JSON.stringify(body) }),

  // ── Kanban ─────────────────────────────────────────────────────────
  kanbanBoards: (signal?: AbortSignal) => request<{ boards: KanbanBoard[] }>('/api/deck/kanban/boards', { signal }),
  kanbanBoardActivate: (slug: string) => request<{ ok: boolean; active: string }>('/api/deck/kanban/boards', { method: 'POST', body: JSON.stringify({ slug }) }),
  kanbanSnapshot: (board = 'default', signal?: AbortSignal) =>
    request<KanbanBoardSnapshot>(`/api/deck/kanban?board=${encodeURIComponent(board)}`, { signal }),
  kanbanTaskDetail: (board: string, id: string, signal?: AbortSignal) =>
    request<KanbanTaskDetail>(`/api/deck/kanban/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`, { signal }),
  kanbanTaskCreate: (board: string, body: {
    title: string; body?: string; assignee?: string; priority?: number;
    workspaceKind?: 'scratch' | 'worktree' | 'session'; workspacePath?: string;
    tenant?: string; parents?: string[]; skills?: string[];
  }) =>
    request<{ ok: boolean; id: string }>(
      `/api/deck/kanban?board=${encodeURIComponent(board)}`,
      { method: 'POST', body: JSON.stringify(body), timeoutMs: 30_000 },
    ),
  kanbanTaskAction: (board: string, id: string, op: 'block' | 'unblock' | 'complete' | 'archive' | 'reclaim', extra?: { reason?: string; summary?: string }) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op, ...extra }), timeoutMs: 30_000 },
    ),
  kanbanTaskAssign: (board: string, id: string, profile: string | null) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op: 'assign', profile }), timeoutMs: 20_000 },
    ),
  kanbanTaskComment: (board: string, id: string, body: string, author?: string) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op: 'comment', body, author }), timeoutMs: 20_000 },
    ),
  kanbanTaskLog: (board: string, id: string, tail?: number, signal?: AbortSignal) => {
    const tailQs = typeof tail === 'number' && tail > 0 ? `&tail=${tail}` : '';
    return request<KanbanTaskLog>(
      `/api/deck/kanban/${encodeURIComponent(id)}/log?board=${encodeURIComponent(board)}${tailQs}`,
      { signal, timeoutMs: 20_000 },
    );
  },
  kanbanTaskContext: (board: string, id: string, signal?: AbortSignal) =>
    request<KanbanTaskContext>(
      `/api/deck/kanban/${encodeURIComponent(id)}/context?board=${encodeURIComponent(board)}`,
      { signal, timeoutMs: 20_000 },
    ),
  kanbanTaskLink: (board: string, parentId: string, childId: string) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(parentId)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op: 'link', childId }), timeoutMs: 20_000 },
    ),
  kanbanTaskUnlink: (board: string, parentId: string, childId: string) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(parentId)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op: 'unlink', childId }), timeoutMs: 20_000 },
    ),
  kanbanTaskEdit: (board: string, id: string, body: { result: string; summary?: string; metadata?: unknown }) =>
    request<{ ok: boolean }>(
      `/api/deck/kanban/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`,
      { method: 'PATCH', body: JSON.stringify({ op: 'edit', ...body }), timeoutMs: 20_000 },
    ),
  kanbanDiagnostics: (board = 'default', opts?: { severity?: string; task?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ board });
    if (opts?.severity) params.set('severity', opts.severity);
    if (opts?.task) params.set('task', opts.task);
    return request<{ diagnostics: KanbanDiagnostic[] }>(
      `/api/deck/kanban/diagnostics?${params.toString()}`,
      { signal, timeoutMs: 12_000 },
    );
  },
  kanbanStats: (board = 'default', signal?: AbortSignal) =>
    request<KanbanStats>(`/api/deck/kanban/stats?board=${encodeURIComponent(board)}`, { signal, timeoutMs: 12_000 }),
  kanbanAssignees: (board = 'default', signal?: AbortSignal) =>
    request<{ assignees: KanbanAssignee[] }>(`/api/deck/kanban/assignees?board=${encodeURIComponent(board)}`, { signal, timeoutMs: 12_000 }),
  /** Build the SSE event-stream URL. Use `new EventSource(url)` to subscribe;
   *  the server emits `{type:'sync',lastId}` first, then `{type:'event',…}` per
   *  new task event, plus an `event: end` frame when the upstream exits. */
  kanbanEventsUrl: (board = 'default', lastId = 0, intervalSec = 1) => {
    const p = new URLSearchParams({ board, lastId: String(lastId), interval: String(intervalSec) });
    return `/api/deck/kanban/events?${p.toString()}`;
  },

  // ── Workspace markdown viewer/editor ─────────────────────────────────
  kanbanMarkdownList: (board: string, id: string, signal?: AbortSignal) =>
    request<KanbanMarkdownListResult>(
      `/api/deck/kanban/${encodeURIComponent(id)}/markdown?board=${encodeURIComponent(board)}`,
      { signal },
    ),
  kanbanMarkdownFile: (board: string, id: string, relPath: string, signal?: AbortSignal) => {
    const p = new URLSearchParams({ board, path: relPath });
    return request<KanbanMarkdownFile>(
      `/api/deck/kanban/${encodeURIComponent(id)}/markdown/file?${p.toString()}`,
      { signal },
    );
  },
  kanbanMarkdownSave: (board: string, id: string, relPath: string, content: string, mtime?: number) =>
    request<{ ok: boolean; path: string; size: number; mtime: number }>(
      `/api/deck/kanban/${encodeURIComponent(id)}/markdown/file?board=${encodeURIComponent(board)}`,
      { method: 'PUT', body: JSON.stringify({ path: relPath, content, mtime }) },
    ),
};
