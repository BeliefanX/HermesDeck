import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileAsync, hermesEnv, makeCache } from './core';
import { runPythonOr } from '../run-python';

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
  recentRowsByHour: number[]; // 24 bins, oldest -> newest
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

// LCM env variables we surface in the dashboard. Defaults mirror config.py.
const LCM_VARS: Record<string, string> = {
  LCM_CONTEXT_THRESHOLD: '0.75',
  LCM_FRESH_TAIL_COUNT: '64',
  LCM_LEAF_CHUNK_TOKENS: '20000',
  LCM_DYNAMIC_LEAF_CHUNK_ENABLED: 'false',
  LCM_DYNAMIC_LEAF_CHUNK_MAX: '40000',
  LCM_NEW_SESSION_RETAIN_DEPTH: '2',
  LCM_IGNORE_SESSION_PATTERNS: '',
  LCM_STATELESS_SESSION_PATTERNS: '',
  LCM_IGNORE_MESSAGE_PATTERNS: '',
  LCM_LARGE_OUTPUT_EXTERNALIZATION_ENABLED: 'false',
  LCM_LARGE_OUTPUT_EXTERNALIZATION_THRESHOLD_CHARS: '12000',
  LCM_LARGE_OUTPUT_TRANSCRIPT_GC_ENABLED: 'false',
  LCM_CRITICAL_BUDGET_PRESSURE_RATIO: '0.0',
  LCM_SUMMARY_MODEL: '(auxiliary)',
  LCM_EXPANSION_MODEL: '(summary / auxiliary)',
  LCM_EXPANSION_CONTEXT_TOKENS: '32000',
  LCM_SUMMARY_TIMEOUT_MS: '60000',
  LCM_EXPANSION_TIMEOUT_MS: '120000',
  LCM_DATABASE_PATH: '(auto)',
  LCM_ENABLE_SLASH_COMMAND: 'false',
  LCM_DOCTOR_CLEAN_APPLY_ENABLED: 'false',
};

function readPluginInfo(): LcmPluginInfo {
  const pluginPath = join(homedir(), '.hermes', 'plugins', 'hermes-lcm');
  let installed = false;
  let version = '';
  let description: string | undefined;
  let author: string | undefined;
  let toolsProvided: string[] = [];
  try {
    const yaml = readFileSync(join(pluginPath, 'plugin.yaml'), 'utf8');
    installed = true;
    const m = (re: RegExp) => yaml.match(re)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    version = m(/^version:\s*(.+)$/m) || '';
    description = m(/^description:\s*"?(.+?)"?$/m);
    author = m(/^author:\s*"?(.+?)"?$/m);
    const toolBlock = yaml.split(/^provides_tools:\s*$/m)[1];
    if (toolBlock) {
      toolsProvided = Array.from(toolBlock.matchAll(/^\s*-\s*(\S+)/gm)).map((mm) => mm[1]);
    }
  } catch {}
  return {
    installed,
    name: 'hermes-lcm',
    version,
    description,
    author,
    path: pluginPath,
    toolsProvided,
  };
}

async function readPluginGit(pluginPath: string): Promise<{ gitCommit?: string; gitBranch?: string; gitDirty?: boolean }> {
  try {
    const [headRes, branchRes, statusRes] = await Promise.allSettled([
      execFileAsync('git', ['-C', pluginPath, 'rev-parse', '--short', 'HEAD'], { timeout: 4000 }),
      execFileAsync('git', ['-C', pluginPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 4000 }),
      execFileAsync('git', ['-C', pluginPath, 'status', '--porcelain'], { timeout: 4000 }),
    ]);
    return {
      gitCommit: headRes.status === 'fulfilled' ? headRes.value.stdout.trim() : undefined,
      gitBranch: branchRes.status === 'fulfilled' ? branchRes.value.stdout.trim() : undefined,
      gitDirty: statusRes.status === 'fulfilled' ? statusRes.value.stdout.trim().length > 0 : undefined,
    };
  } catch {
    return {};
  }
}

function fileBytes(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function buildConfigSnapshot(): LcmConfigSnapshot {
  const values: LcmConfigSnapshot['values'] = {};
  for (const [key, def] of Object.entries(LCM_VARS)) {
    const fromEnv = process.env[key];
    const fromHermes = hermesEnv[key];
    if (fromEnv != null && fromEnv !== '') values[key] = { value: fromEnv, source: 'env', default: def };
    else if (fromHermes != null && fromHermes !== '') values[key] = { value: fromHermes, source: 'hermes-env', default: def };
    else values[key] = { value: def, source: 'default', default: def };
  }
  return { source: 'env', values };
}

async function readProfileStats(profileId: string): Promise<LcmProfileStats> {
  const home = join(homedir(), '.hermes');
  const dbPath = profileId === 'default' ? join(home, 'lcm.db') : join(home, 'profiles', profileId, 'lcm.db');
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const empty: LcmProfileStats = {
    profile: profileId,
    dbPath,
    dbBytes: 0,
    walBytes: 0,
    shmBytes: 0,
    journalMode: '',
    quickCheck: '',
    schemaVersion: null,
    rows: 0,
    sessions: 0,
    tokens: 0,
    pinned: 0,
    byRole: {},
    bySource: [],
    topSessions: [],
    recentRowsByHour: new Array(24).fill(0),
    summaryNodes: 0,
    summaryTokens: 0,
    summaryMaxDepth: 0,
    summaryByDepth: {},
    lifecycle: {
      rows: 0,
      debtKinds: {},
      totalDebt: 0,
      lastFinalizedAt: null,
      lastRolloverAt: null,
      lastMaintenanceAt: null,
    },
    largestRows: [],
    oldestAt: null,
    newestAt: null,
  };
  const dbBytes = fileBytes(dbPath);
  if (!dbBytes) return { ...empty, error: 'db_missing' };

  // Read everything in one Python pass so we only open the SQLite file once.
  const script = String.raw`
import sqlite3, json, os, time
db = os.environ['DB']
out = {}
try:
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    cur = con.cursor()
    def one(q, *p):
        try:
            r = cur.execute(q, p).fetchone()
            return r[0] if r else None
        except Exception:
            return None
    def many(q, *p):
        try:
            return cur.execute(q, p).fetchall()
        except Exception:
            return []
    out['journalMode'] = one('PRAGMA journal_mode') or ''
    out['quickCheck']  = one('PRAGMA quick_check') or ''
    out['schemaVersion'] = one("SELECT value FROM metadata WHERE key='schema_version'")
    out['rows']     = int(one('SELECT COUNT(*) FROM messages') or 0)
    out['sessions'] = int(one('SELECT COUNT(DISTINCT session_id) FROM messages') or 0)
    out['tokens']   = int(one('SELECT COALESCE(SUM(token_estimate),0) FROM messages') or 0)
    out['pinned']   = int(one('SELECT COALESCE(SUM(pinned),0) FROM messages') or 0)
    out['oldestAt'] = one('SELECT MIN(timestamp) FROM messages')
    out['newestAt'] = one('SELECT MAX(timestamp) FROM messages')
    out['byRole']    = {r: int(c) for r, c in many('SELECT role, COUNT(*) FROM messages GROUP BY role')}
    out['bySource']  = [{'source': (s or '(unknown)'), 'rows': int(c)} for s, c in many('SELECT source, COUNT(*) FROM messages GROUP BY source ORDER BY 2 DESC LIMIT 12')]
    out['topSessions'] = [
        {'sessionId': sid, 'rows': int(rc), 'tokens': int(tk or 0), 'lastAt': lat}
        for sid, rc, tk, lat in many('SELECT session_id, COUNT(*), COALESCE(SUM(token_estimate),0), MAX(timestamp) FROM messages GROUP BY session_id ORDER BY 2 DESC LIMIT 10')
    ]
    now = time.time()
    bins = [0] * 24
    for ts, in many('SELECT timestamp FROM messages WHERE timestamp >= ?', now - 86400):
        try:
            age_h = int((now - float(ts)) // 3600)
            if 0 <= age_h < 24:
                bins[23 - age_h] += 1
        except Exception:
            pass
    out['recentRowsByHour'] = bins
    out['summaryNodes']    = int(one('SELECT COUNT(*) FROM summary_nodes') or 0)
    out['summaryTokens']   = int(one('SELECT COALESCE(SUM(token_count),0) FROM summary_nodes') or 0)
    out['summaryMaxDepth'] = int(one('SELECT COALESCE(MAX(depth),0) FROM summary_nodes') or 0)
    out['summaryByDepth']  = {str(d): int(c) for d, c in many('SELECT depth, COUNT(*) FROM summary_nodes GROUP BY depth ORDER BY depth')}
    life_rows = int(one('SELECT COUNT(*) FROM lcm_lifecycle_state') or 0)
    debt_kinds = {(k or '(none)'): int(c) for k, c in many('SELECT debt_kind, COUNT(*) FROM lcm_lifecycle_state GROUP BY debt_kind')}
    total_debt = int(one('SELECT COALESCE(SUM(debt_size_estimate),0) FROM lcm_lifecycle_state') or 0)
    last_fin  = one('SELECT MAX(last_finalized_at)         FROM lcm_lifecycle_state')
    last_roll = one('SELECT MAX(last_rollover_at)          FROM lcm_lifecycle_state')
    last_maint= one('SELECT MAX(last_maintenance_attempt_at) FROM lcm_lifecycle_state')
    out['lifecycle'] = {
        'rows': life_rows, 'debtKinds': debt_kinds, 'totalDebt': total_debt,
        'lastFinalizedAt': last_fin, 'lastRolloverAt': last_roll, 'lastMaintenanceAt': last_maint,
    }
    out['largestRows'] = [
        {'storeId': int(sid), 'sessionId': ses, 'role': role, 'bytes': int(b or 0)}
        for sid, ses, role, b in many('SELECT store_id, session_id, role, LENGTH(content) FROM messages ORDER BY LENGTH(content) DESC NULLS LAST LIMIT 8')
    ]
    con.close()
except Exception as e:
    out['error'] = f'{type(e).__name__}: {e}'
print(json.dumps(out, ensure_ascii=False))
`;
  type ProbeShape = Partial<Omit<LcmProfileStats, 'profile' | 'dbPath' | 'dbBytes' | 'walBytes' | 'shmBytes'>>;
  const data = await runPythonOr<ProbeShape>(script, {}, {
    timeoutMs: 8000,
    env: { ...process.env, DB: dbPath },
  });
  return {
    ...empty,
    dbBytes,
    walBytes: fileBytes(walPath),
    shmBytes: fileBytes(shmPath),
    ...data,
    // recentRowsByHour can be undefined when Python failed entirely; keep zeros.
    recentRowsByHour: Array.isArray(data.recentRowsByHour) && data.recentRowsByHour.length === 24
      ? data.recentRowsByHour : empty.recentRowsByHour,
    lifecycle: { ...empty.lifecycle, ...(data.lifecycle || {}) },
  };
}

async function listLcmProfiles(): Promise<string[]> {
  // Discover by file presence — anything that has a non-empty lcm.db, plus 'default'.
  const home = join(homedir(), '.hermes');
  const profiles = ['default'];
  try {
    const { readdirSync } = await import('node:fs');
    const entries = readdirSync(join(home, 'profiles'), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const path = join(home, 'profiles', e.name, 'lcm.db');
      if (fileBytes(path) > 0) profiles.push(e.name);
    }
  } catch {}
  return profiles;
}

async function getLcmDashboardUncached(): Promise<LcmDashboard> {
  const plugin = readPluginInfo();
  const git = plugin.installed ? await readPluginGit(plugin.path) : {};
  Object.assign(plugin, git);

  const config = buildConfigSnapshot();
  const profileIds = await listLcmProfiles();
  const profiles = await Promise.all(profileIds.map(readProfileStats));

  const totals = profiles.reduce(
    (acc, p) => ({
      rows: acc.rows + p.rows,
      sessions: acc.sessions + p.sessions,
      tokens: acc.tokens + p.tokens,
      summaryNodes: acc.summaryNodes + p.summaryNodes,
      dbBytes: acc.dbBytes + p.dbBytes + p.walBytes + p.shmBytes,
    }),
    { rows: 0, sessions: 0, tokens: 0, summaryNodes: 0, dbBytes: 0 },
  );

  return {
    plugin,
    config,
    profiles,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

export const getLcmDashboard = makeCache(5_000, getLcmDashboardUncached);
