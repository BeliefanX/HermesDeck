export type HealthStatus = 'connected' | 'degraded' | 'unreachable';

export type DeckRole = 'super_admin' | 'admin' | 'user';
export type DeckUserStatus = 'pending' | 'active' | 'disabled' | 'rejected';

export interface DeckUserCapabilities {
  canUseApp: boolean;
  canManageUsers: boolean;
  canApproveUsers: boolean;
  canUseTerminal: boolean;
  canManageOwnCredentials: boolean;
}

export interface DeckAuthSession {
  authenticated: boolean;
  userId?: string;
  username?: string;
  displayName?: string;
  email?: string;
  role?: DeckRole;
  status?: DeckUserStatus;
  assignedProfileIds?: string[];
  capabilities?: DeckUserCapabilities;
  expiresAt?: number;
  bootstrap?: boolean;
}

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
  /** Total sessions recorded under this profile's state.db. */
  sessionCount?: number;
  /** ISO timestamp of the most recent session activity for this profile. */
  lastActiveAt?: string;
}

export interface DeckCronJob {
  id: string;
  name?: string;
  status: 'enabled' | 'paused' | 'disabled' | 'running';
  state?: string;
  enabled: boolean;
  schedule: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  promptPreview?: string;
  deliver?: string;
  skills: string[];
  skill?: string;
  toolsets: string[];
  model?: string;
  provider?: string;
  workdir?: string;
  profile?: string;
  script?: string;
  noAgent?: boolean;
  repeat?: Record<string, unknown>;
  lastError?: string;
  lastDeliveryError?: string;
  createdAt?: string;
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
  /** `file` covers any non-text, non-image binary the model returned (PDF, audio, archive, …). */
  kind: 'text' | 'image' | 'file';
  text?: string;
  dataUrl?: string;
  /** Remote URL alternative to `dataUrl` — used when the artifact is too large to inline as base64. */
  url?: string;
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

/** A single agent turn — one user prompt → assistant reply (with optional
 *  tool calls in between). Derived from Hermes state.db rather than from a
 *  dedicated runs table, because Hermes records execution as messages. */
export interface DeckRun {
  id: string;
  sessionId: string;
  sessionTitle?: string;
  profileId: string;
  status: 'success' | 'failed' | 'running' | 'cancelled';
  model?: string;
  source?: string;
  /** ISO timestamp the user message arrived. */
  startedAt?: string;
  /** ISO timestamp of the final assistant / tool message. */
  endedAt?: string;
  /** Duration in ms; undefined when still running. */
  durationMs?: number;
  /** Count of tool invocations during this run. */
  toolCallCount: number;
  /** Distinct tool names invoked. */
  toolNames: string[];
  /** Truncated user prompt (first 120 chars). */
  promptPreview?: string;
  /** Truncated assistant reply (first 120 chars). */
  replyPreview?: string;
  /** Error / failure message extracted from the trailing message, if any. */
  errorSummary?: string;
}

export interface DeckRunDetail extends DeckRun {
  /** Ordered timeline of messages that made up this run. */
  events: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system' | (string & {});
    content: string;
    createdAt?: string;
    toolName?: string;
    toolCallId?: string;
    toolCalls?: Array<{ id?: string; name?: string; arguments?: string }>;
  }>;
}

export interface ToolSummary {
  name: string;
  kind: 'toolset' | 'skill' | 'mcp' | 'unknown';
  enabled?: boolean;
  description?: string;
  /** Human-friendly category, e.g. "creative", "software-development", "Apple". */
  category?: string;
  /** Where this capability comes from: builtin / local / config / mcp / plugin. */
  source?: 'builtin' | 'local' | 'hub' | 'config' | 'mcp' | 'plugin' | 'unknown';
  /** Trust level reported by Hermes (skills only). */
  trust?: string;
  /** Higher-level grouping for the deck UI: research / coding / browser / files / messaging / devops / media / agents / unknown. */
  taskGroup?: 'research' | 'coding' | 'browser' | 'files' | 'messaging' | 'devops' | 'media' | 'agents' | 'memory' | 'planning' | 'unknown';
  /** True if Hermes reported an authentication problem for this capability. */
  authFailed?: boolean;
  /** Skill-only: relative path of the directory containing SKILL.md, rooted
   *  at `~/.hermes/skills/`. Lets the UI request content/edit without
   *  re-deriving the path from `name` + `category`. */
  relPath?: string;
}

export interface SkillContent {
  relPath: string;
  name: string;
  category?: string;
  content: string;
  /** ISO mtime — pass back on save as an optimistic-lock token. */
  mtime: string;
  size: number;
  readOnly?: boolean;
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
  /** Listed in the provider's current model catalog (`provider_model_ids`). */
  available?: boolean;
  /** Has appeared in at least one session under this provider. */
  used?: boolean;
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
  /** True if any credential for this provider reports an auth failure. */
  authFailed?: boolean;
  /** Models known for this provider — either the configured default, listed
   *  in the provider catalog, or actually used in a session. */
  models: ModelInfo[];
}

export interface DeckModelsResponse {
  default?: { provider: string; model: string; baseUrl?: string };
  providers: ProviderInfo[];
  /** Sessions whose model column is set but whose provider is unknown. */
  orphanModels: ModelInfo[];
  /** Configured `agent.reasoning_effort` from this profile's config.yaml. */
  reasoningEffort?: string;
  /** Valid reasoning effort choices for the composer. */
  reasoningLevels?: string[];
}

export interface DeckModelPreference {
  modelId?: string;
  modelProvider?: string;
  updatedAt: string;
}

export interface DeckModelPreferenceResponse {
  ok: true;
  profileId: string;
  preference: DeckModelPreference | null;
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

/** Aggregate counts that span the entire Hermes state, not just the recent
 *  sessions sample. Power dashboard headline metrics so the user can trust the
 *  scope of what they're seeing. */
export interface DeckStats {
  /** Profile this snapshot covers; "all" means every profile's state.db. */
  scope: 'all' | string;
  /** Total session rows across the included state.db files. */
  totalSessions: number;
  /** Sum of message rows across the included state.db files. */
  totalMessages: number;
  /** Sessions with started_at within the last 24h. */
  activeSessions24h: number;
  /** Messages with created_at within the last 24h. */
  activeMessages24h: number;
  /** Per-profile breakdown of session counts. */
  perProfile: Array<{ profileId: string; sessions: number; messages: number; lastActiveAt?: string }>;
  /** Per-source breakdown across all included sessions. */
  perSource: Array<{ source: string; sessions: number }>;
  /** ISO timestamp of the most recent activity (any profile). */
  lastActiveAt?: string;
}

export interface LcmPluginInfo {
  installed: boolean;
  name: string;
  version: string;
  description?: string;
  author?: string;
  path: string;
  toolsProvided: string[];
  gitCommit?: string;
  gitBranch?: string;
  gitDirty?: boolean;
}

export interface LcmConfigEntry {
  value: string;
  source: 'env' | 'hermes-env' | 'default';
  default?: string;
}

export interface LcmProfileStats {
  profile: string;
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
  journalMode: string;
  quickCheck: string;
  schemaVersion: string | null;
  rows: number;
  sessions: number;
  tokens: number;
  pinned: number;
  byRole: Record<string, number>;
  bySource: Array<{ source: string; rows: number }>;
  topSessions: Array<{ sessionId: string; rows: number; tokens: number; lastAt: number | null }>;
  recentRowsByHour: number[];
  summaryNodes: number;
  summaryTokens: number;
  summaryMaxDepth: number;
  summaryByDepth: Record<string, number>;
  lifecycle: {
    rows: number;
    debtKinds: Record<string, number>;
    totalDebt: number;
    lastFinalizedAt: number | null;
    lastRolloverAt: number | null;
    lastMaintenanceAt: number | null;
  };
  largestRows: Array<{ storeId: number; sessionId: string; role: string; bytes: number }>;
  oldestAt: number | null;
  newestAt: number | null;
  error?: string;
}

export interface LcmDashboard {
  plugin: LcmPluginInfo;
  config: { source: string; values: Record<string, LcmConfigEntry> };
  profiles: LcmProfileStats[];
  totals: {
    rows: number;
    sessions: number;
    tokens: number;
    summaryNodes: number;
    dbBytes: number;
  };
  generatedAt: string;
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

/** A kanban board — one project / workstream. The `default` slug is special:
 *  its DB lives at `~/.hermes/kanban.db` for back-compat. Others live under
 *  `~/.hermes/kanban/boards/<slug>/kanban.db`. */
export interface KanbanBoard {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  createdAt?: string;
  archived?: boolean;
  active?: boolean;
  /** Aggregate counts populated when listing — saves a per-board roundtrip. */
  counts?: { triage: number; todo: number; ready: number; running: number; blocked: number; done: number; archived: number; total: number };
}

export type KanbanTaskStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'archived' | (string & {});

export interface KanbanTask {
  id: string;
  title: string;
  body?: string;
  status: KanbanTaskStatus;
  assignee?: string;
  priority: number;
  createdBy?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  workspaceKind?: string;
  workspacePath?: string;
  tenant?: string;
  result?: string;
  spawnFailures?: number;
  consecutiveFailures?: number;
  lastFailureError?: string;
  maxRetries?: number | null;
  workerPid?: number | null;
  lastHeartbeatAt?: string;
  parents?: string[];
  children?: string[];
  /** Skills the worker should load on this task (in addition to kanban-worker). */
  skills?: string[];
}

export interface KanbanComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface KanbanEvent {
  id: number;
  runId?: number | null;
  kind: string;
  payload?: unknown;
  createdAt: string;
}

export interface KanbanRun {
  id: number;
  profile?: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  outcome?: string;
  summary?: string;
  error?: string;
}

export interface KanbanTaskDetail extends KanbanTask {
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
}

/** A single Markdown file discovered under a task's workspace path. */
export interface KanbanMarkdownEntry {
  /** Path relative to the workspace root. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** mtime as seconds since epoch (so the client can format with `relTime`). */
  mtime: number;
}

export interface KanbanMarkdownListResult {
  /** Absolute resolved workspace root, or null when the task has none. */
  root: string | null;
  entries: KanbanMarkdownEntry[];
}

export interface KanbanMarkdownFile {
  path: string;
  size: number;
  mtime: number;
  content: string;
}

/** Per-board task summary returned by GET /api/deck/kanban?board=… */
export interface KanbanBoardSnapshot {
  board: KanbanBoard;
  tasks: KanbanTask[];
}

export interface KanbanDiagnostic {
  taskId?: string;
  severity: 'warning' | 'error' | 'critical' | (string & {});
  kind: string;
  message: string;
  createdAt?: string;
}

export interface KanbanStats {
  total: number;
  byStatus: Record<string, number>;
  byAssignee: Record<string, number>;
  oldestReadyAgeSec?: number;
}

export interface KanbanAssignee {
  profile: string;
  counts: { ready: number; running: number; blocked: number; done: number; total: number };
  /** True when the profile is known on this machine (lives under ~/.hermes/profiles/). */
  known?: boolean;
}

export interface KanbanTaskLog {
  log: string;
  truncated: boolean;
}

export interface KanbanTaskContext {
  context: string;
}

// Live tmux-backed terminal — separate from the allowlisted action runner.
export interface LiveTerminalSession {
  id: string;
  tmuxName: string;
  label: string;
  createdAt: number;
  cols: number;
  rows: number;
  alive: boolean;
}

export interface LiveTerminalWindow {
  index: number;
  name: string;
  active: boolean;
}

export interface LiveTerminalCreateRequest {
  label?: string;
  cols?: number;
  rows?: number;
}

export interface LiveTerminalListResponse {
  enabled: boolean;
  sessions: LiveTerminalSession[];
}

export type LiveTerminalTmuxRequest =
  | { action: 'new-window'; name?: string }
  | { action: 'kill-window'; windowIndex: number }
  | { action: 'select-window'; windowIndex: number }
  | { action: 'rename-window'; windowIndex: number; name: string }
  | { action: 'split-pane'; direction: 'h' | 'v' }
  | { action: 'select-pane'; paneTarget: 'U' | 'D' | 'L' | 'R' };
