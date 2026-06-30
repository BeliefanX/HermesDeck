import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultHermesRoot, execFileAsync, makeCache } from './core';

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
  unavailableReason?: string;
}

type RawProfileStats = Omit<LcmProfileStats, 'profile' | 'dbPath' | 'dbBytes' | 'walBytes' | 'shmBytes'>;

const LCM_CONFIG_KEYS = [
  'LCM_CONTEXT_THRESHOLD',
  'LCM_FRESH_TAIL_COUNT',
  'LCM_LEAF_CHUNK_TOKENS',
  'LCM_SUMMARY_MODEL',
  'LCM_DATABASE_PATH',
];

const DASHBOARD_SQL_PY = String.raw`
import json, os, sqlite3, sys
path = sys.argv[1]

def one(cur, sql, params=(), default=0):
    row = cur.execute(sql, params).fetchone()
    return row[0] if row and row[0] is not None else default

def table_exists(cur, name):
    return bool(cur.execute("select 1 from sqlite_master where type='table' and name=?", (name,)).fetchone())

try:
    uri = 'file:' + path + '?mode=ro'
    con = sqlite3.connect(uri, uri=True, timeout=2.0)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    journal = one(cur, 'PRAGMA journal_mode', default='')
    quick = one(cur, 'PRAGMA quick_check', default='unknown')
    schema = None
    if table_exists(cur, 'metadata'):
        schema = one(cur, "select value from metadata where key='schema_version'", default=None)
    has_messages = table_exists(cur, 'messages')
    has_summary = table_exists(cur, 'summary_nodes')
    has_lifecycle = table_exists(cur, 'lcm_lifecycle_state')
    rows = one(cur, 'select count(*) from messages') if has_messages else 0
    sessions = one(cur, 'select count(distinct session_id) from messages') if has_messages else 0
    tokens = one(cur, 'select coalesce(sum(token_estimate),0) from messages') if has_messages else 0
    pinned = one(cur, 'select count(*) from messages where pinned = 1') if has_messages else 0
    by_role = {r['role'] or 'unknown': int(r['rows']) for r in cur.execute('select role, count(*) rows from messages group by role') } if has_messages else {}
    by_source = [dict(source=r['source'] or 'unknown', rows=int(r['rows'])) for r in cur.execute('select coalesce(nullif(trim(source), \'\'), \'unknown\') source, count(*) rows from messages group by 1 order by rows desc limit 12')] if has_messages else []
    top_sessions = [dict(sessionId=r['session_id'], rows=int(r['rows']), tokens=int(r['tokens'] or 0), lastAt=r['last_at']) for r in cur.execute('select session_id, count(*) rows, coalesce(sum(token_estimate),0) tokens, max(timestamp) last_at from messages group by session_id order by rows desc limit 10')] if has_messages else []
    now = one(cur, 'select strftime(\'%s\',\'now\')', default=0)
    recent = [0] * 24
    if has_messages:
        for r in cur.execute('select cast(((? - timestamp) / 3600) as integer) h, count(*) rows from messages where timestamp >= ? - 86400 group by h', (now, now)):
            h = int(r['h'])
            if 0 <= h < 24:
                recent[23 - h] = int(r['rows'])
    summary_nodes = one(cur, 'select count(*) from summary_nodes') if has_summary else 0
    summary_tokens = one(cur, 'select coalesce(sum(token_count),0) from summary_nodes') if has_summary else 0
    summary_max_depth = one(cur, 'select coalesce(max(depth),0) from summary_nodes') if has_summary else 0
    summary_by_depth = {str(r['depth']): int(r['rows']) for r in cur.execute('select depth, count(*) rows from summary_nodes group by depth')} if has_summary else {}
    lifecycle = dict(rows=0, debtKinds={}, totalDebt=0, lastFinalizedAt=None, lastRolloverAt=None, lastMaintenanceAt=None)
    if has_lifecycle:
        lifecycle = dict(
            rows=one(cur, 'select count(*) from lcm_lifecycle_state'),
            debtKinds={r['debt_kind'] or 'none': int(r['rows']) for r in cur.execute('select debt_kind, count(*) rows from lcm_lifecycle_state group by debt_kind')},
            totalDebt=one(cur, 'select coalesce(sum(debt_size_estimate),0) from lcm_lifecycle_state'),
            lastFinalizedAt=one(cur, 'select max(last_finalized_at) from lcm_lifecycle_state', default=None),
            lastRolloverAt=one(cur, 'select max(last_rollover_at) from lcm_lifecycle_state', default=None),
            lastMaintenanceAt=one(cur, 'select max(last_maintenance_attempt_at) from lcm_lifecycle_state', default=None),
        )
    largest = [dict(storeId=int(r['store_id']), sessionId=r['session_id'], role=r['role'], bytes=int(r['bytes'] or 0)) for r in cur.execute('select store_id, session_id, role, length(cast(content as blob)) bytes from messages order by bytes desc limit 10')] if has_messages else []
    out = dict(journalMode=str(journal), quickCheck=str(quick), schemaVersion=None if schema is None else str(schema), rows=rows, sessions=sessions, tokens=tokens, pinned=pinned, byRole=by_role, bySource=by_source, topSessions=top_sessions, recentRowsByHour=recent, summaryNodes=summary_nodes, summaryTokens=summary_tokens, summaryMaxDepth=summary_max_depth, summaryByDepth=summary_by_depth, lifecycle=lifecycle, largestRows=largest, oldestAt=one(cur, 'select min(timestamp) from messages', default=None) if has_messages else None, newestAt=one(cur, 'select max(timestamp) from messages', default=None) if has_messages else None)
except Exception as e:
    out = dict(error=str(e), journalMode='', quickCheck='error', schemaVersion=None, rows=0, sessions=0, tokens=0, pinned=0, byRole={}, bySource=[], topSessions=[], recentRowsByHour=[0]*24, summaryNodes=0, summaryTokens=0, summaryMaxDepth=0, summaryByDepth={}, lifecycle=dict(rows=0, debtKinds={}, totalDebt=0, lastFinalizedAt=None, lastRolloverAt=None, lastMaintenanceAt=None), largestRows=[], oldestAt=None, newestAt=None)
print(json.dumps(out))
`;

function parsePluginYaml(path: string): Partial<LcmPluginInfo> {
  try {
    const text = readFileSync(path, 'utf8');
    const scalar = (key: string) => text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'))?.[1]?.trim();
    const tools = [...text.matchAll(/^\s*-\s*([\w.-]+)\s*$/gm)].map((m) => m[1]!).filter((name) => name.startsWith('lcm_'));
    return { name: scalar('name'), version: scalar('version'), description: scalar('description'), author: scalar('author'), toolsProvided: tools };
  } catch {
    return {};
  }
}

function lcmPluginInfo(root: string): LcmPluginInfo {
  const pluginDir = join(root, 'plugins', 'hermes-lcm');
  const meta = parsePluginYaml(join(pluginDir, 'plugin.yaml'));
  return {
    installed: existsSync(join(pluginDir, 'plugin.yaml')),
    name: meta.name || 'hermes-lcm',
    version: meta.version || '—',
    description: meta.description,
    author: meta.author,
    path: meta.name ? '~/.hermes/plugins/hermes-lcm' : '',
    toolsProvided: meta.toolsProvided || [],
  };
}

function lcmConfigSnapshot(): LcmConfigSnapshot {
  const values: LcmConfigSnapshot['values'] = {};
  for (const key of LCM_CONFIG_KEYS) {
    const value = process.env[key];
    if (value) values[key] = { value: key.endsWith('PATH') ? basename(value) : value, source: 'env' };
  }
  return { source: Object.keys(values).length ? 'env' : 'default', values };
}

function profileHomes(root: string): Array<{ profile: string; home: string; displayDb: string }> {
  const homes = [{ profile: 'default', home: root, displayDb: '~/.hermes/lcm.db' }];
  const profilesDir = join(root, 'profiles');
  try {
    for (const name of readdirSync(profilesDir)) {
      if (!/^[\w.-]{1,64}$/.test(name)) continue;
      const home = join(profilesDir, name);
      if (statSync(home).isDirectory()) homes.push({ profile: name, home, displayDb: `~/.hermes/profiles/${name}/lcm.db` });
    }
  } catch {}
  return homes;
}

async function readProfile(profile: string, dbPath: string, displayDb: string): Promise<LcmProfileStats | null> {
  if (!existsSync(dbPath)) return null;
  const dbBytes = statSync(dbPath).size;
  const walBytes = existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0;
  const shmBytes = existsSync(`${dbPath}-shm`) ? statSync(`${dbPath}-shm`).size : 0;
  const { stdout } = await execFileAsync('python3', ['-c', DASHBOARD_SQL_PY, dbPath], { timeout: 5000, maxBuffer: 1024 * 1024 });
  const raw = JSON.parse(stdout) as RawProfileStats;
  return { profile, dbPath: displayDb, dbBytes, walBytes, shmBytes, ...raw };
}

// Deck-owned, read-only adapter over hermes-lcm's existing on-disk SQLite state.
async function getLcmDashboardUncached(): Promise<LcmDashboard> {
  const root = defaultHermesRoot();
  const profiles = (await Promise.all(
    profileHomes(root).map(({ profile, home, displayDb }) => readProfile(profile, join(home, 'lcm.db'), displayDb)),
  )).filter((p): p is LcmProfileStats => Boolean(p));
  return {
    plugin: lcmPluginInfo(root),
    config: lcmConfigSnapshot(),
    profiles,
    totals: {
      rows: profiles.reduce((n, p) => n + p.rows, 0),
      sessions: profiles.reduce((n, p) => n + p.sessions, 0),
      tokens: profiles.reduce((n, p) => n + p.tokens, 0),
      summaryNodes: profiles.reduce((n, p) => n + p.summaryNodes, 0),
      dbBytes: profiles.reduce((n, p) => n + p.dbBytes, 0),
    },
    generatedAt: new Date().toISOString(),
  };
}

export const getLcmDashboard = makeCache(5_000, getLcmDashboardUncached);
