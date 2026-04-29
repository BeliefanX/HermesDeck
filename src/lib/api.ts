import type { DeckHealth, DeckProfile, DeckSession, DeckMessage, ToolSummary, TerminalAction, TerminalRunRequest, TerminalRunResult, DeckModelsResponse, TokenStats } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(await res.text() || `Request failed: ${res.status}`);
  return res.json();
}

export const deckApi = {
  health: () => request<DeckHealth>('/api/deck/health'),
  profiles: () => request<{ profiles: DeckProfile[] }>('/api/deck/profiles'),
  sessions: (profileId = 'default') => request<{ sessions: DeckSession[] }>(`/api/deck/sessions?profile=${encodeURIComponent(profileId)}`),
  messages: (sessionId: string, profileId = 'default') => request<{ messages: DeckMessage[] }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(profileId)}`),
  deleteSession: (sessionId: string, profileId = 'default') => request<{ ok: boolean; removed: number }>(`/api/deck/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profileId)}`, { method: 'DELETE' }),
  tools: () => request<{ tools: ToolSummary[] }>('/api/deck/tools'),
  models: () => request<DeckModelsResponse>('/api/deck/models'),
  tokens: (days = 14) => request<TokenStats>(`/api/deck/tokens?days=${days}`),
  terminalActions: () => request<{ actions: TerminalAction[] }>('/api/deck/terminal/actions'),
  terminalRun: (body: TerminalRunRequest) => request<TerminalRunResult>('/api/deck/terminal/run', { method: 'POST', body: JSON.stringify(body) }),
};
