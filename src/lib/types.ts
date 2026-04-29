export type HealthStatus = 'connected' | 'degraded' | 'unreachable';

export interface DeckHealth {
  ok: boolean;
  status: HealthStatus;
  version: string;
  apiServer: { baseUrl: string; healthy: boolean; detail?: string };
  dashboard: { baseUrl?: string; healthy: boolean; detail?: string };
  uptimeSeconds?: number;
}

export interface DeckProfile {
  id: string;
  name: string;
  alias?: string;
  active: boolean;
  model?: string;
  gateway?: string;
  toolsets: string[];
  hermesHome?: string;
}

export interface DeckSession {
  id: string;
  profileId: string;
  title: string;
  source: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  pinned?: boolean;
  folderId?: string;
  /** Parent session id when this row was spawned by a parent agent (subagent). */
  parentSessionId?: string;
  /** Count of direct children (subagents) — populated by backend join. */
  childCount?: number;
}

export interface DeckAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image';
  text?: string;
  dataUrl?: string;
}

export interface DeckMessage {
  id: string;
  /** `session_meta` and other Hermes-internal roles may appear in historical sessions. */
  role: 'user' | 'assistant' | 'system' | 'tool' | (string & {});
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  attachments?: DeckAttachment[];
  /** Tool name on assistant tool-call rows or on tool-result rows. */
  toolName?: string;
  /** Tool call id linking an assistant call to its tool result row. */
  toolCallId?: string;
  /** Parsed tool_calls array (assistant rows that delegate to a tool). */
  toolCalls?: Array<{ id?: string; name?: string; arguments?: string }>;
}

export interface DeckRunEvent {
  id: string;
  runId: string;
  sessionId?: string;
  type: string;
  payload: unknown;
  ts: number;
}

export interface ToolSummary {
  name: string;
  kind: 'toolset' | 'skill' | 'mcp' | 'unknown';
  enabled?: boolean;
  description?: string;
}

/** A single model that has been used or is configured under a provider. */
export interface ModelInfo {
  id: string;
  /** True if this model is the configured default in config.yaml. */
  isDefault?: boolean;
  /** Total sessions historically using this model under this provider. */
  sessions?: number;
  /** Sum of input + output tokens across all sessions for this model. */
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** ISO timestamp of the most recent session using this model. */
  lastUsed?: string;
}

export interface ProviderInfo {
  /** Stable identifier (e.g. "openai-codex"). */
  id: string;
  /** Friendly display name. */
  name: string;
  /** Number of credentials configured for this provider via `hermes auth`. */
  credentialCount?: number;
  /** Whether this provider is currently the default in config.yaml. */
  isDefault?: boolean;
  /** Default base_url, when known. */
  baseUrl?: string;
  /** Models known for this provider — either the configured default or any
   *  model that has actually been used in a session. */
  models: ModelInfo[];
}

export interface DeckModelsResponse {
  default?: { provider: string; model: string; baseUrl?: string };
  providers: ProviderInfo[];
  /** Sessions whose model column is set but whose provider is unknown. */
  orphanModels: ModelInfo[];
}

export interface TokenStats {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
    sessions: number;
    apiCalls: number;
    /** USD; sums actual_cost_usd, falling back to estimated_cost_usd. */
    cost: number;
  };
  /** Last 24h subset, derived from session started_at. */
  last24h: { input: number; output: number; total: number; sessions: number; cost: number };
  /** Daily token series for the last N days (oldest first). */
  daily: Array<{ date: string; input: number; output: number; total: number; cost: number; sessions: number }>;
  /** Hour-of-day distribution (0-23) over the analysed window. */
  hourly: number[];
  /** Day-of-week distribution (Mon..Sun) over the analysed window. */
  weekday: number[];
  /** Top models by tokens in the analysed window. */
  topModels: Array<{ model: string; tokens: number; sessions: number; cost: number }>;
  /** Top sources/platforms by tokens. */
  topSources: Array<{ source: string; tokens: number; sessions: number }>;
  /** Window length in days the stats cover. */
  windowDays: number;
}

export interface TerminalAction {
  id: string;
  label: string;
  description: string;
  commandPreview: string;
  category: 'hermes' | 'system' | 'diagnostic';
  profileAware?: boolean;
  maxTimeoutMs: number;
}

export interface TerminalRunRequest {
  actionId: string;
  profileId?: string;
  timeoutMs?: number;
}

export interface TerminalRunResult {
  ok: boolean;
  actionId: string;
  label: string;
  commandPreview: string;
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  error?: string;
}
