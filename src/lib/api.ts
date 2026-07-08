import type { DeckAuthSession, DeckHealth, DeckProfile, DeckSession, DeckMessage, ToolSummary, TerminalAction, TerminalRunRequest, TerminalRunResult, DeckModelsResponse, DeckModelPreferenceResponse, DeckNotificationConfigResponse, DeckNotificationPreferences, TokenStats, DeckStats, DeckCronJob, DeckCapabilities, DeckGatewayStatus, DeckToolset, DeckSkillCatalogItem, LiveTerminalSession, LiveTerminalListResponse, LiveTerminalWindow, LiveTerminalCreateRequest, LiveTerminalTmuxRequest, SkillContent, LcmDashboard } from './types';
import type { MetaStore } from './session-meta';
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
  capabilities: (profileId = 'default', signal?: AbortSignal) =>
    request<DeckCapabilities>(`/api/deck/capabilities?profile=${encodeURIComponent(profileId)}`, { signal }),
  gatewayStatus: (profileId = 'default', signal?: AbortSignal) =>
    request<DeckGatewayStatus>(`/api/deck/gateway/status?profile=${encodeURIComponent(profileId)}`, { signal }),
  stats: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<DeckStats>(`/api/deck/stats${qs}`, { signal });
  },
  profiles: (signal?: AbortSignal) => request<{ profiles: DeckProfile[]; error?: string; detail?: string }>('/api/deck/profiles', { signal }),
  sessions: (profileId = 'default', signal?: AbortSignal) =>
    request<{ sessions: DeckSession[]; metaStore?: MetaStore }>(`/api/deck/sessions?profile=${encodeURIComponent(profileId)}`, { signal }),
  sessionMeta: (profileId = 'default', signal?: AbortSignal) =>
    request<{ ok: true; profileId: string; metaStore: MetaStore }>(`/api/deck/session-meta?profile=${encodeURIComponent(profileId)}`, { signal }),
  saveSessionMeta: (profileId: string, metaStore: MetaStore) =>
    request<{ ok: true; profileId: string; metaStore: MetaStore }>('/api/deck/session-meta', {
      method: 'PUT',
      body: JSON.stringify({ profileId, metaStore }),
      timeoutMs: 15_000,
    }),
  messages: (sessionId: string, profileId = 'default', signal?: AbortSignal) =>
    request<{ messages: DeckMessage[] }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(profileId)}`, { signal }),
  chatApproval: (body: { profileId: string; sessionId: string; runId: string; choice: 'once' | 'session' | 'always' | 'deny' }) =>
    request<{ ok: true }>('/api/deck/chat/approval', { method: 'POST', body: JSON.stringify(body), timeoutMs: 30_000 }),
  chatRunStatus: (body: { profileId: string; sessionId: string; runId: string }, signal?: AbortSignal) =>
    request<{ ok: true; run: unknown }>(`/api/deck/chat/runs/${encodeURIComponent(body.runId)}?profile=${encodeURIComponent(body.profileId)}&sessionId=${encodeURIComponent(body.sessionId)}`, { signal, timeoutMs: 10_000 }),
  chatRunStop: (body: { profileId: string; sessionId: string; runId: string }) =>
    request<{ ok: true; runId: string; status?: string }>(`/api/deck/chat/runs/${encodeURIComponent(body.runId)}/stop`, { method: 'POST', body: JSON.stringify(body), timeoutMs: 15_000 }),
  forkSession: (sessionId: string, profileId = 'default', body: Record<string, unknown> = {}) =>
    request<{ ok: true; result: unknown }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}/fork?profile=${encodeURIComponent(profileId)}`, { method: 'POST', body: JSON.stringify(body), timeoutMs: 15_000 }),
  updateSession: (sessionId: string, profileId = 'default', body: { title?: string | null; end_reason?: string }) =>
    request<{ ok: true; result: unknown }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profileId)}`, { method: 'PATCH', body: JSON.stringify(body), timeoutMs: 15_000 }),
  deleteSession: (sessionId: string, profileId = 'default') =>
    request<{ ok: boolean; removed: number }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profileId)}`, { method: 'DELETE' }),
  tools: (profileId = 'default', signal?: AbortSignal) =>
    request<{ tools: ToolSummary[] }>(`/api/deck/tools?profile=${encodeURIComponent(profileId)}`, { signal }),
  toolsets: (profileId = 'default', signal?: AbortSignal) =>
    request<{ profileId: string; toolsets: DeckToolset[] }>(`/api/deck/toolsets?profile=${encodeURIComponent(profileId)}`, { signal }),
  skillCatalog: (profileId = 'default', signal?: AbortSignal) =>
    request<{ profileId: string; skills: DeckSkillCatalogItem[] }>(`/api/deck/skill-catalog?profile=${encodeURIComponent(profileId)}`, { signal }),
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
    request<{ ok: true; subscriptionCount: number; subscription?: { id: string } }>('/api/deck/notifications/subscription', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  deletePushSubscription: (endpoint: string) =>
    request<{ ok: true; subscriptionCount: number }>(`/api/deck/notifications/subscription`, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
  sendTestNotification: (profileId?: string, sessionId?: string) =>
    request<{ ok: true; sent: number; unavailable?: boolean }>('/api/deck/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ ...(profileId ? { profileId } : {}), ...(sessionId ? { sessionId } : {}) }),
      timeoutMs: 30_000,
    }),
  // Token aggregation can be slow when state.db is large; bump the timeout.
  tokens: (days = 14, signal?: AbortSignal, profileId?: string) => {
    const params = new URLSearchParams({ days: String(days) });
    if (profileId) params.set('profile', profileId);
    return request<TokenStats>(`/api/deck/tokens?${params.toString()}`, { signal, timeoutMs: 30_000 });
  },
  cronJobs: (profileId?: string, signal?: AbortSignal) => {
    const qs = profileId ? `?profile=${encodeURIComponent(profileId)}` : '';
    return request<{ jobs: DeckCronJob[] }>(`/api/deck/cron${qs}`, { signal, timeoutMs: 30_000 });
  },
  cronJob: (jobId: string, profileId = 'default', signal?: AbortSignal) =>
    request<{ job: unknown }>(`/api/deck/cron/${encodeURIComponent(jobId)}?profile=${encodeURIComponent(profileId)}`, { signal, timeoutMs: 15_000 }),
  cronCreate: (profileId: string, body: Record<string, unknown>) =>
    request<unknown>(`/api/deck/cron?profile=${encodeURIComponent(profileId)}`, { method: 'POST', body: JSON.stringify(body), timeoutMs: 15_000 }),
  cronUpdate: (jobId: string, profileId: string, body: Record<string, unknown>) =>
    request<unknown>(`/api/deck/cron/${encodeURIComponent(jobId)}?profile=${encodeURIComponent(profileId)}`, { method: 'PATCH', body: JSON.stringify(body), timeoutMs: 15_000 }),
  cronDelete: (jobId: string, profileId: string) =>
    request<unknown>(`/api/deck/cron/${encodeURIComponent(jobId)}?profile=${encodeURIComponent(profileId)}`, { method: 'DELETE', timeoutMs: 15_000 }),
  cronAction: (jobId: string, profileId: string, action: 'pause' | 'resume' | 'run') =>
    request<unknown>(`/api/deck/cron/${encodeURIComponent(jobId)}/${action}?profile=${encodeURIComponent(profileId)}`, { method: 'POST', body: JSON.stringify({}), timeoutMs: 15_000 }),
  terminalActions: (signal?: AbortSignal) => request<{ actions: TerminalAction[] }>('/api/deck/terminal/actions', { signal }),
  terminalRun: (body: TerminalRunRequest) => request<TerminalRunResult>('/api/deck/terminal/run', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60_000 }),

  liveList: () => request<LiveTerminalListResponse>('/api/deck/term/sessions'),
  liveCreate: (body: LiveTerminalCreateRequest = {}) => request<{ session: LiveTerminalSession }>('/api/deck/term/sessions', { method: 'POST', body: JSON.stringify(body) }),
  liveKill: (id: string) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  liveInput: (id: string, data: string) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/input`, { method: 'POST', body: JSON.stringify({ data }) }),
  liveResize: (id: string, cols: number, rows: number) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  liveWindows: (id: string) => request<{ windows: LiveTerminalWindow[] }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/windows`),
  liveTmux: (id: string, body: LiveTerminalTmuxRequest) => request<{ ok: boolean }>(`/api/deck/term/sessions/${encodeURIComponent(id)}/tmux`, { method: 'POST', body: JSON.stringify(body) }),
};
