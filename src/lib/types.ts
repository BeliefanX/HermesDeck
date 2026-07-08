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
  assignedAgentIds?: string[];
  /** Compatibility alias for persisted/auth API payloads; prefer assignedAgentIds. */
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
  /** Default/effective reasoning effort for this Agent, when Hermes exposes it. */
  reasoningEffort?: string;
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

export interface DeckCapabilities {
  ok: boolean;
  profileId: string;
  features: Record<string, unknown>;
  endpoints: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export interface DeckGatewayStatus {
  ok: boolean;
  profileId: string;
  status: string;
  platform?: unknown;
  version?: unknown;
  gatewayState?: unknown;
  activeAgents?: unknown;
  gatewayBusy?: unknown;
  gatewayDrainable?: unknown;
  updatedAt?: unknown;
  platforms?: unknown;
  pid?: unknown;
  exitReason?: unknown;
}

export interface DeckToolset {
  name: string;
  label?: string;
  description?: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

export interface DeckSkillCatalogItem {
  name: string;
  description?: string;
  category?: string;
  source?: string;
  trust?: string;
}

export interface DeckSession {
  id: string;
  profileId: string;
  title: string;
  source: string;
  model?: string;
  /** Effective reasoning effort if exposed by Hermes or observed by Deck. */
  reasoningEffort?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  pinned?: boolean;
  folderId?: string;
  archived?: boolean;
  archivedAt?: string;
  customTitle?: string;
  tags?: string[];
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

export interface DeckNotificationPreferences {
  chatCompleted: boolean;
  chatFailed: boolean;
  cronJobCompleted: boolean;
  updatedAt?: string;
}

export interface DeckNotificationConfig {
  available: boolean;
  publicKey: string | null;
  subject: string | null;
  reason?: string;
}

export interface DeckNotificationConfigResponse {
  ok: true;
  config: DeckNotificationConfig;
  preferences: DeckNotificationPreferences;
  subscriptionCount: number;
  subscriptions?: Array<{
    id: string;
    expirationTime?: number | null;
    userAgent?: string;
    createdAt: string;
    updatedAt: string;
  }>;
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
  unavailableReason?: string;
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
  unavailableReason?: string;
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
