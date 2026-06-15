import { hermesApiGet, makeCache } from './core';

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

export interface LcmConfigSnapshot {
  source: 'env' | 'hermes-env' | 'default';
  values: Record<string, { value: string; source: 'env' | 'hermes-env' | 'default'; default?: string }>;
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

export interface LcmDashboard {
  plugin: LcmPluginInfo;
  config: LcmConfigSnapshot;
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

// API-only LCM adapter. HermesDeck no longer inspects plugin files, git state,
// env snapshots, or local runtime databases directly. If Hermes Agent has not implemented LCM
// endpoints yet, this intentionally surfaces the API gap instead of fabricating
// an empty dashboard from local probes.
async function getLcmDashboardUncached(): Promise<LcmDashboard> {
  try {
    return await hermesApiGet<LcmDashboard>('/api/lcm', 30_000);
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    if (!/failed with 404\b/.test(msg)) throw first;
    try {
      return await hermesApiGet<LcmDashboard>('/api/lcm/dashboard', 30_000);
    } catch (second) {
      const detail = second instanceof Error ? second.message : String(second);
      throw new Error(`Hermes Agent API LCM dashboard unavailable: ${detail}`);
    }
  }
}

export const getLcmDashboard = makeCache(5_000, getLcmDashboardUncached);
