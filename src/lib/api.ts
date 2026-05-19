import type { DeckHealth, DeckProfile, DeckSession, DeckMessage, ToolSummary, TerminalAction, TerminalRunRequest, TerminalRunResult, DeckModelsResponse, TokenStats, DeckStats, DeckRun, DeckRunDetail, LiveTerminalSession, LiveTerminalListResponse, LiveTerminalWindow, LiveTerminalCreateRequest, LiveTerminalTmuxRequest, SkillContent, KanbanBoard, KanbanBoardSnapshot, KanbanTaskDetail, KanbanDiagnostic, KanbanStats, KanbanAssignee, KanbanTaskLog, KanbanTaskContext, KanbanMarkdownListResult, KanbanMarkdownFile, LcmDashboard } from './types';
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

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const real = signals.filter((s): s is AbortSignal => Boolean(s));
  if (real.length === 0) return AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  if (real.length === 1) return real[0]!;
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(real);
  // Fallback for older runtimes (browsers without AbortSignal.any).
  const ctrl = new AbortController();
  for (const s of real) {
    if (s.aborted) { ctrl.abort((s as AbortSignal & { reason?: unknown }).reason); break; }
    s.addEventListener('abort', () => ctrl.abort((s as AbortSignal & { reason?: unknown }).reason), { once: true });
  }
  return ctrl.signal;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = combineSignals([init?.signal ?? undefined, AbortSignal.timeout(timeoutMs)]);
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
    const msg = (parsedBody && typeof parsedBody === 'object' && parsedBody !== null && 'error' in parsedBody && typeof (parsedBody as { error: unknown }).error === 'string')
      ? (parsedBody as { error: string }).error
      : (text || `Request failed: ${res.status}`);
    throw new ApiError(res.status, parsedBody, msg);
  }
  return res.json();
}

export const deckApi = {
  health: (signal?: AbortSignal) => request<DeckHealth>('/api/deck/health', { signal }),
  stats: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<DeckStats>(`/api/deck/stats${qs}`, { signal });
  },
  profiles: (signal?: AbortSignal) => request<{ profiles: DeckProfile[] }>('/api/deck/profiles', { signal }),
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
  // Token aggregation can be slow when state.db is large; bump the timeout.
  tokens: (days = 14, signal?: AbortSignal) => request<TokenStats>(`/api/deck/tokens?days=${days}`, { signal, timeoutMs: 30_000 }),
  runs: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<{ runs: DeckRun[] }>(`/api/deck/runs${qs}`, { signal, timeoutMs: 30_000 });
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
