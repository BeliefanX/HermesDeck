import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DeckHealth, DeckProfile, DeckSession, DeckMessage, ToolSummary, TerminalAction, TerminalRunRequest, TerminalRunResult, DeckModelsResponse, ProviderInfo, ModelInfo, TokenStats } from '@/lib/types';

const execFileAsync = promisify(execFile);
const startedAt = Date.now();

function readHermesEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const text = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      env[key] = val;
    }
  } catch {}
  return env;
}

const hermesEnv = readHermesEnv();
const defaultApiPort = hermesEnv.API_SERVER_PORT || hermesEnv.HERMES_API_SERVER_PORT || '8642';

export const HERMES_API_BASE = process.env.HERMES_API_BASE || hermesEnv.HERMES_API_BASE || `http://127.0.0.1:${defaultApiPort}`;
export const HERMES_DASHBOARD_BASE = process.env.HERMES_DASHBOARD_BASE || hermesEnv.HERMES_DASHBOARD_BASE || 'http://127.0.0.1:9120';

function apiHeaders() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || hermesEnv.HERMES_API_KEY || hermesEnv.API_SERVER_KEY;
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function hermesVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('hermes', ['--version'], { timeout: 8000 });
    return stdout.trim() || 'Hermes';
  } catch (err) {
    return `Hermes (${err instanceof Error ? err.message : 'version unavailable'})`;
  }
}

export async function getHealth(): Promise<DeckHealth> {
  const version = await hermesVersion();
  let apiHealthy = false;
  let apiDetail = '';
  try {
    const r = await fetch(`${HERMES_API_BASE}/health`, { cache: 'no-store', headers: apiHeaders(), signal: AbortSignal.timeout(2500) });
    apiHealthy = r.ok;
    apiDetail = await r.text().then((t) => t.slice(0, 240)).catch(() => '');
  } catch (e) {
    apiDetail = e instanceof Error ? e.message : String(e);
  }
  let dashHealthy = false;
  let dashDetail = '';
  try {
    const r = await fetch(`${HERMES_DASHBOARD_BASE}/api/sessions`, { cache: 'no-store', signal: AbortSignal.timeout(1200) });
    dashHealthy = r.ok || r.status === 401 || r.status === 403;
    dashDetail = `HTTP ${r.status}`;
  } catch (e) {
    dashDetail = e instanceof Error ? e.message : String(e);
  }
  return {
    ok: apiHealthy || version.startsWith('Hermes Agent'),
    status: apiHealthy ? 'connected' : version.startsWith('Hermes Agent') ? 'degraded' : 'unreachable',
    version,
    apiServer: { baseUrl: HERMES_API_BASE, healthy: apiHealthy, detail: apiDetail },
    dashboard: { baseUrl: HERMES_DASHBOARD_BASE, healthy: dashHealthy, detail: dashDetail },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

export async function getProfiles(): Promise<DeckProfile[]> {
  let active = 'default';
  try {
    const { stdout } = await execFileAsync('hermes', ['profile', 'show'], { timeout: 8000 });
    const m = stdout.match(/(?:Active profile|Profile)[:\s]+([\w.-]+)/i);
    if (m) active = m[1];
  } catch {}
  try {
    const { stdout } = await execFileAsync('hermes', ['profile', 'list'], { timeout: 10000 });
    const rows = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const profiles: DeckProfile[] = [];
    for (const line of rows) {
      if (/^(NAME|Profile|---)/i.test(line) || /^[─\-\s]+$/.test(line)) continue;
      const isActive = /[◆*▶>]/.test(line.slice(0, 3));
      const clean = line.replace(/^[◆*▶>\s]+/, '').trim();
      const cols = clean.split(/\s{2,}|\t+/).filter(Boolean);
      const first = cols[0] || clean.split(/\s+/)[0];
      if (!first || /profile/i.test(first)) continue;
      const id = first.replace(/[：:]/g, '');
      profiles.push({ id, name: id, active: id === active || isActive, model: cols[1] || '', gateway: cols[2] || '', alias: cols[3] || '', toolsets: [] });
    }
    const dedup = Array.from(new Map(profiles.map((p) => [p.id, p])).values());
    return dedup.length ? dedup : [{ id: 'default', name: 'default', active: true, toolsets: [] }];
  } catch {
    return [{ id: 'default', name: 'default', active: true, toolsets: [] }];
  }
}

export async function getSessions(profile = 'default'): Promise<DeckSession[]> {
  const script = String.raw`
import sqlite3, json, os, pathlib, datetime
profile=os.environ.get('PROFILE','default')
home=pathlib.Path.home()/'.hermes'
if profile and profile!='default': home=home/'profiles'/profile
state=home/'state.db'
out=[]
if state.exists():
  con=sqlite3.connect(state)
  con.row_factory=sqlite3.Row
  cols=[r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
  sel=[]
  for c in ['id','session_id','source','model','prompt','title','created_at','updated_at','started_at','message_count','total_messages','parent_session_id']:
    if c in cols: sel.append(c)
  order_col = 'updated_at' if 'updated_at' in cols else 'started_at' if 'started_at' in cols else 'created_at' if 'created_at' in cols else sel[0]
  has_parent = 'parent_session_id' in cols
  # Pre-aggregate child counts in one pass; correlated subqueries grow O(N*M)
  # which gets noticeable past a few hundred sessions.
  child_counts = {}
  if has_parent:
    for row in con.execute('select parent_session_id, count(*) c from sessions where parent_session_id is not null group by parent_session_id').fetchall():
      pid = row['parent_session_id']
      if pid: child_counts[str(pid)] = int(row['c'])
  # Drop ghost sessions — rows that exist (often because a stream was
  # interrupted before _persist_session ran) but have zero messages of their
  # own. These would render as empty bubbles in the deck, sometimes
  # confusingly carrying a subagent count from children that DO have data.
  # In-flight optimistic sessions on the deck side survive via mergeSessions
  # because they're kept in cachedExtra when not present in the remote list.
  msg_session_col = None
  msg_cols = [r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
  if 'session_id' in msg_cols: msg_session_col = 'session_id'
  elif 'conversation_id' in msg_cols: msg_session_col = 'conversation_id'
  where_clause = ''
  if msg_session_col:
    where_clause = f' where exists (select 1 from messages where {msg_session_col}=sessions.id limit 1)'
  rows=con.execute('select '+','.join(sel)+' from sessions'+where_clause+' order by '+order_col+' desc limit 200').fetchall() if sel else []
  # Build a fallback title map from the first user message of each session,
  # for sessions that don't store a title/prompt column (e.g. ones created via
  # api_server /v1/responses, including HermesDeck Web). Without this we'd
  # fall back to the raw session UUID, which looks like garbled text in the UI.
  first_user_text = {}
  if msg_session_col and 'role' in msg_cols and 'content' in msg_cols:
    order_msg = 'created_at' if 'created_at' in msg_cols else ('id' if 'id' in msg_cols else msg_session_col)
    sql = f"select {msg_session_col} as sid, content from messages where role='user' group by {msg_session_col} having min({order_msg})"
    try:
      for mr in con.execute(sql).fetchall():
        sid_k = str(mr['sid']) if mr['sid'] is not None else ''
        c = mr['content']
        if not sid_k or not c: continue
        # content may be a JSON-encoded list of parts (multimodal). Pull text.
        text = ''
        try:
          parsed = json.loads(c) if isinstance(c, str) and c.startswith('[') else c
          if isinstance(parsed, list):
            for p in parsed:
              if isinstance(p, dict) and (p.get('type') in ('text','input_text')) and p.get('text'):
                text = str(p['text']); break
          elif isinstance(parsed, str):
            text = parsed
        except Exception:
          text = str(c)
        text = (text or '').strip().split('\n')[0][:80]
        if text: first_user_text[sid_k] = text
    except Exception:
      pass
  for r in rows:
    d=dict(r)
    sid=str(d.get('session_id') or d.get('id'))
    title=d.get('title') or (str(d.get('prompt') or '').strip().split('\n')[0][:80]) or first_user_text.get(sid) or sid
    parent = d.get('parent_session_id') if has_parent else None
    item = {'id':sid,'profileId':profile,'title':title,'source':d.get('source') or 'hermes','model':d.get('model') or '', 'createdAt':str(d.get('created_at') or d.get('started_at') or ''), 'updatedAt':str(d.get('updated_at') or d.get('started_at') or d.get('created_at') or ''), 'messageCount':d.get('message_count') or d.get('total_messages') or 0}
    if parent: item['parentSessionId'] = str(parent)
    cc = child_counts.get(sid, 0)
    if cc: item['childCount'] = cc
    out.append(item)
print(json.dumps(out, ensure_ascii=False))`;
  try {
    const { stdout } = await execFileAsync('python3', ['-c', script], { timeout: 10000, env: { ...process.env, PROFILE: profile } });
    return JSON.parse(stdout) as DeckSession[];
  } catch { return []; }
}

export async function tagSessionSource(sessionId: string, source: string, profile = 'default'): Promise<void> {
  // Re-stamp the session row's `source` column. api_server hardcodes
  // source='api_server' on creation; we use this to mark deck-originated
  // chats as 'hermesdeck' so they're distinguishable from CLI / external
  // /v1/responses callers in every device that reads state.db.
  if (!sessionId || !source) return;
  const script = String.raw`
import sqlite3, os, pathlib
profile=os.environ.get('PROFILE','default'); sid=os.environ.get('SID',''); src=os.environ.get('SRC','')
home=pathlib.Path.home()/'.hermes'
if profile and profile!='default': home=home/'profiles'/profile
state=home/'state.db'
if sid and src and state.exists():
  con=sqlite3.connect(state)
  try:
    cols=[r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
    if 'source' in cols and 'id' in cols:
      con.execute('UPDATE sessions SET source=? WHERE id=?', (src, sid))
      con.commit()
  finally:
    con.close()`;
  try {
    await execFileAsync('python3', ['-c', script], { timeout: 5000, env: { ...process.env, PROFILE: profile, SID: sessionId, SRC: source } });
  } catch {
    // Tagging is best-effort — failure just means the session shows as
    // 'api_server' until the next deck interaction with that id.
  }
}

export async function deleteSession(sessionId: string, profile = 'default'): Promise<{ ok: boolean; removed: number }> {
  const script = String.raw`
import sqlite3, json, os, pathlib
profile=os.environ.get('PROFILE','default'); sid=os.environ.get('SID','')
home=pathlib.Path.home()/'.hermes'
if profile and profile!='default': home=home/'profiles'/profile
state=home/'state.db'
removed=0
if sid and state.exists():
  con=sqlite3.connect(state)
  try:
    con.execute('PRAGMA foreign_keys = OFF')
    msg_cols=[r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
    if msg_cols:
      session_col='session_id' if 'session_id' in msg_cols else 'conversation_id' if 'conversation_id' in msg_cols else None
      if session_col:
        con.execute(f'DELETE FROM messages WHERE {session_col}=?', (sid,))
    sess_cols=[r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
    if sess_cols:
      sess_id_col='id' if 'id' in sess_cols else 'session_id' if 'session_id' in sess_cols else None
      if sess_id_col:
        cur=con.execute(f'DELETE FROM sessions WHERE {sess_id_col}=?', (sid,))
        removed=cur.rowcount or 0
    con.commit()
  finally:
    con.close()
print(json.dumps({'ok':True,'removed':removed}))`;
  try {
    const { stdout } = await execFileAsync('python3', ['-c', script], { timeout: 10000, env: { ...process.env, PROFILE: profile, SID: sessionId } });
    return JSON.parse(stdout) as { ok: boolean; removed: number };
  } catch { return { ok: false, removed: 0 }; }
}

export async function getMessages(sessionId: string, profile = 'default'): Promise<DeckMessage[]> {
  const script = String.raw`
import sqlite3, json, os, pathlib
profile=os.environ.get('PROFILE','default'); sid=os.environ.get('SID','')
home=pathlib.Path.home()/'.hermes'
if profile and profile!='default': home=home/'profiles'/profile
state=home/'state.db'; out=[]
if state.exists():
  con=sqlite3.connect(state); con.row_factory=sqlite3.Row
  cols=[r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
  if cols:
    session_col='session_id' if 'session_id' in cols else 'conversation_id' if 'conversation_id' in cols else None
    role_col='role' if 'role' in cols else 'speaker' if 'speaker' in cols else None
    content_col='content' if 'content' in cols else 'message' if 'message' in cols else None
    if session_col and role_col and content_col:
      order='created_at' if 'created_at' in cols else 'id'
      for r in con.execute(f'select * from messages where {session_col}=? order by {order} asc limit 1000',(sid,)).fetchall():
        d=dict(r)
        item={'id':str(d.get('id') or len(out)), 'role':d.get(role_col) or 'assistant', 'content':d.get(content_col) or '', 'createdAt':str(d.get('created_at') or '')}
        if 'tool_name' in cols and d.get('tool_name'): item['toolName']=str(d.get('tool_name'))
        if 'tool_call_id' in cols and d.get('tool_call_id'): item['toolCallId']=str(d.get('tool_call_id'))
        if 'tool_calls' in cols and d.get('tool_calls'):
          try:
            tc=json.loads(d['tool_calls']) if isinstance(d['tool_calls'], str) else d['tool_calls']
            if isinstance(tc, list):
              normalized=[]
              for entry in tc:
                if not isinstance(entry, dict): continue
                fn=entry.get('function') if isinstance(entry.get('function'), dict) else {}
                normalized.append({'id': entry.get('id') or entry.get('call_id'), 'name': fn.get('name') or entry.get('name'), 'arguments': fn.get('arguments') or entry.get('arguments')})
              if normalized: item['toolCalls']=normalized
          except Exception: pass
        out.append(item)
print(json.dumps(out, ensure_ascii=False))`;
  try {
    const { stdout } = await execFileAsync('python3', ['-c', script], { timeout: 10000, env: { ...process.env, PROFILE: profile, SID: sessionId } });
    return JSON.parse(stdout) as DeckMessage[];
  } catch { return []; }
}

export async function getTools(): Promise<ToolSummary[]> {
  const tools: ToolSummary[] = [];
  // Hermes `tools list` output prefixes each item with a status glyph
  // (✓ enabled / ✗ disabled / ● etc.) followed by whitespace and the actual
  // tool identifier. We strip that prefix here so the UI shows real names.
  const stripStatus = (line: string): { rest: string; enabled: boolean } => {
    const m = line.match(/^([✓✔✗✘●○•])\s*(?:enabled|disabled|on|off)?\s+(.*)$/i);
    if (m) return { rest: m[2], enabled: !/✗|✘/.test(m[1]) && !/disabled|off/i.test(line) };
    return { rest: line, enabled: !/disabled|off/i.test(line) };
  };
  try {
    const { stdout } = await execFileAsync('hermes', ['tools', 'list'], { timeout: 12000 });
    for (const line of stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      // Skip section headers (lines ending with ':' or fully separator-like)
      if (/:$/.test(t) || /^(Tool|Tools|---|===)/i.test(t)) continue;
      const { rest, enabled } = stripStatus(t);
      const name = rest.split(/\s{2,}|\t| - /)[0].trim();
      if (!name) continue;
      tools.push({ name, kind: 'toolset', enabled, description: rest });
    }
  } catch {}
  try {
    const { stdout } = await execFileAsync('hermes', ['skills', 'list'], { timeout: 12000 });
    for (const line of stdout.split(/\r?\n/).slice(0, 80)) {
      const t = line.trim();
      if (!t || /^[-=]/.test(t) || /:$/.test(t)) continue;
      const { rest } = stripStatus(t);
      const name = rest.split(/\s{2,}|\t/)[0].trim();
      if (!name) continue;
      tools.push({ name, kind: 'skill', description: rest });
    }
  } catch {}
  return tools.slice(0, 200);
}

// ─── Provider / model discovery ────────────────────────────────────
// We combine three signals:
//   1. config.yaml `model.{default,provider,base_url}` → the active default
//   2. `hermes auth list` → which providers have credentials configured
//   3. sessions table aggregation → which provider+model combos have actually
//      been used, plus historical token totals
// The merged view answers "what providers and models does this Hermes have
// access to" without depending on a single canonical registry endpoint.

const PROVIDER_LABELS: Record<string, string> = {
  'openai-codex': 'OpenAI Codex',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'gemini': 'Google Gemini',
  'copilot': 'GitHub Copilot',
  'ollama-cloud': 'Ollama Cloud',
  'ollama': 'Ollama',
  'minimax-cn': 'MiniMax (CN)',
  'openrouter': 'OpenRouter',
  'nous': 'Nous Research',
  'bedrock': 'AWS Bedrock',
  'azure': 'Azure OpenAI',
};

function prettyProvider(id: string): string {
  return PROVIDER_LABELS[id] || id.replace(/(^|[-_])(.)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
}

async function listAuthProviders(): Promise<Array<{ id: string; credentialCount: number }>> {
  try {
    const { stdout } = await execFileAsync('hermes', ['auth', 'list'], { timeout: 8000 });
    const out: Array<{ id: string; credentialCount: number }> = [];
    for (const raw of stdout.split(/\r?\n/)) {
      // Lines look like:  "openai-codex (1 credentials):"
      const m = raw.match(/^([\w.-]+)\s+\((\d+)\s+credentials?\):/);
      if (m) out.push({ id: m[1], credentialCount: Number(m[2]) || 0 });
    }
    return out;
  } catch { return []; }
}

async function readDefaultModel(): Promise<{ provider?: string; model?: string; baseUrl?: string }> {
  // Parse the YAML by hand for the few keys we need; keeps us out of taking
  // on a yaml dep just for one block.
  try {
    const text = readFileSync(join(homedir(), '.hermes', 'config.yaml'), 'utf8');
    // Match the top-level `model:` block (non-greedy, until next top-level key).
    const block = text.match(/^model:\s*\n((?:[ \t]+.*\n?)+)/m);
    if (!block) return {};
    const out: { provider?: string; model?: string; baseUrl?: string } = {};
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (!m) continue;
      const [, key, valRaw] = m;
      const val = valRaw.replace(/^["']|["']$/g, '');
      if (key === 'default') out.model = val;
      else if (key === 'provider') out.provider = val;
      else if (key === 'base_url') out.baseUrl = val;
    }
    return out;
  } catch { return {}; }
}

export async function getModels(): Promise<DeckModelsResponse> {
  const [auth, def] = await Promise.all([listAuthProviders(), readDefaultModel()]);

  // Aggregate models actually seen in state.db sessions.
  const script = String.raw`
import sqlite3, pathlib, json, datetime
home = pathlib.Path.home() / '.hermes'
db = home / 'state.db'
if not db.exists():
    print('[]'); raise SystemExit
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
need = ['billing_provider','model','input_tokens','output_tokens','started_at']
have = [c for c in need if c in cols]
if 'model' not in have:
    print('[]'); raise SystemExit
sel = ', '.join(have)
rows = con.execute(f'select {sel} from sessions').fetchall()
agg = {}
for r in rows:
    d = dict(r)
    model = d.get('model')
    if not model: continue
    prov = d.get('billing_provider') or ''
    key = (prov, model)
    cur = agg.setdefault(key, {'provider': prov, 'model': model, 'sessions': 0, 'inputTokens': 0, 'outputTokens': 0, 'lastUsed': ''})
    cur['sessions'] += 1
    cur['inputTokens'] += int(d.get('input_tokens') or 0)
    cur['outputTokens'] += int(d.get('output_tokens') or 0)
    raw_ts = d.get('started_at')
    if raw_ts is not None:
        try:
            iso = datetime.datetime.fromtimestamp(float(raw_ts)).isoformat()
        except (TypeError, ValueError):
            iso = str(raw_ts)
        if iso > cur['lastUsed']: cur['lastUsed'] = iso
print(json.dumps(list(agg.values()), ensure_ascii=False))`;

  type Row = { provider: string; model: string; sessions: number; inputTokens: number; outputTokens: number; lastUsed: string };
  let rows: Row[] = [];
  try {
    const { stdout } = await execFileAsync('python3', ['-c', script], { timeout: 10000 });
    rows = JSON.parse(stdout) as Row[];
  } catch {}

  // Build provider buckets from the union of (auth-listed) and (history-seen).
  const byProvider = new Map<string, ProviderInfo>();
  for (const a of auth) {
    byProvider.set(a.id, {
      id: a.id, name: prettyProvider(a.id), credentialCount: a.credentialCount,
      isDefault: a.id === def.provider, baseUrl: a.id === def.provider ? def.baseUrl : undefined,
      models: [],
    });
  }

  const orphans: ModelInfo[] = [];
  for (const r of rows) {
    const tokens = r.inputTokens + r.outputTokens;
    const m: ModelInfo = {
      id: r.model,
      sessions: r.sessions,
      tokens,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      lastUsed: r.lastUsed || undefined,
      isDefault: r.model === def.model && r.provider === def.provider,
    };
    if (!r.provider) { orphans.push(m); continue; }
    let p = byProvider.get(r.provider);
    if (!p) {
      p = { id: r.provider, name: prettyProvider(r.provider), credentialCount: 0, isDefault: r.provider === def.provider, models: [] };
      byProvider.set(r.provider, p);
    }
    p.models.push(m);
  }

  // Make sure the configured default is always present, even if it has no
  // history yet (newly configured Hermes).
  if (def.provider && def.model) {
    const p = byProvider.get(def.provider) || { id: def.provider, name: prettyProvider(def.provider), credentialCount: 0, isDefault: true, baseUrl: def.baseUrl, models: [] };
    if (!p.models.some((m) => m.id === def.model)) {
      p.models.unshift({ id: def.model!, isDefault: true });
    } else {
      p.models = p.models.map((m) => m.id === def.model ? { ...m, isDefault: true } : m);
    }
    byProvider.set(def.provider, p);
  }

  // Sort models within each provider by tokens desc; default first.
  for (const p of byProvider.values()) {
    p.models.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return (b.tokens || 0) - (a.tokens || 0);
    });
  }

  // Provider order: default first, then by total tokens desc, then by name.
  const providers = Array.from(byProvider.values()).sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    const at = a.models.reduce((s, m) => s + (m.tokens || 0), 0);
    const bt = b.models.reduce((s, m) => s + (m.tokens || 0), 0);
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });

  return {
    default: def.provider && def.model ? { provider: def.provider, model: def.model, baseUrl: def.baseUrl } : undefined,
    providers,
    orphanModels: orphans,
  };
}

// ─── Token / usage analytics ──────────────────────────────────────
// Pulled from sessions table directly so we can render daily / hourly /
// per-source breakdowns without parsing `hermes insights` text.

export async function getTokenStats(days = 14): Promise<TokenStats> {
  const safeDays = Math.max(1, Math.min(180, Math.floor(days || 14)));
  const script = String.raw`
import sqlite3, pathlib, json, datetime, sys
DAYS = ${safeDays}
home = pathlib.Path.home() / '.hermes'
db = home / 'state.db'
empty = {
  'totals': {'input':0,'output':0,'cacheRead':0,'cacheWrite':0,'reasoning':0,'total':0,'sessions':0,'apiCalls':0,'cost':0.0},
  'last24h': {'input':0,'output':0,'total':0,'sessions':0,'cost':0.0},
  'daily': [], 'hourly': [0]*24, 'weekday': [0]*7,
  'topModels': [], 'topSources': [], 'windowDays': DAYS,
}
if not db.exists():
    print(json.dumps(empty)); sys.exit(0)
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
def has(c): return c in cols
needed = [c for c in ['source','model','started_at','message_count','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','actual_cost_usd','estimated_cost_usd','api_call_count'] if has(c)]
if 'started_at' not in needed:
    print(json.dumps(empty)); sys.exit(0)
sel = ', '.join(needed)
rows = con.execute(f'select {sel} from sessions').fetchall()

now = datetime.datetime.now()
cutoff_window = now - datetime.timedelta(days=DAYS)
cutoff_24h = now - datetime.timedelta(hours=24)

def parse_ts(s):
    if s in (None, ''): return None
    # Hermes stores started_at as a unix timestamp float; older rows may be ISO.
    try:
        return datetime.datetime.fromtimestamp(float(s))
    except (TypeError, ValueError):
        pass
    s = str(s)
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f','%Y-%m-%dT%H:%M:%S','%Y-%m-%d %H:%M:%S.%f','%Y-%m-%d %H:%M:%S'):
        try: return datetime.datetime.strptime(s.split('+')[0].split('Z')[0], fmt)
        except Exception: pass
    return None

totals = {'input':0,'output':0,'cacheRead':0,'cacheWrite':0,'reasoning':0,'total':0,'sessions':0,'apiCalls':0,'cost':0.0}
last24h = {'input':0,'output':0,'total':0,'sessions':0,'cost':0.0}
daily = {}  # date_str -> agg
hourly = [0]*24
weekday = [0]*7
by_model = {}
by_source = {}

for r in rows:
    d = dict(r)
    inp = int(d.get('input_tokens') or 0)
    out = int(d.get('output_tokens') or 0)
    cr = int(d.get('cache_read_tokens') or 0)
    cw = int(d.get('cache_write_tokens') or 0)
    rt = int(d.get('reasoning_tokens') or 0)
    actual = d.get('actual_cost_usd')
    est = d.get('estimated_cost_usd')
    cost = float(actual if actual not in (None, 0, 0.0) else (est or 0))
    ttl = inp + out
    totals['input'] += inp; totals['output'] += out
    totals['cacheRead'] += cr; totals['cacheWrite'] += cw
    totals['reasoning'] += rt; totals['total'] += ttl
    totals['sessions'] += 1
    totals['apiCalls'] += int(d.get('api_call_count') or 0)
    totals['cost'] += cost

    ts = parse_ts(d.get('started_at'))
    if ts and ts >= cutoff_24h:
        last24h['input'] += inp; last24h['output'] += out
        last24h['total'] += ttl; last24h['sessions'] += 1; last24h['cost'] += cost
    if ts and ts >= cutoff_window:
        date_key = ts.strftime('%Y-%m-%d')
        b = daily.setdefault(date_key, {'date': date_key,'input':0,'output':0,'total':0,'cost':0.0,'sessions':0})
        b['input'] += inp; b['output'] += out; b['total'] += ttl; b['cost'] += cost; b['sessions'] += 1
        hourly[ts.hour] += ttl
        weekday[ts.weekday()] += ttl
        m = d.get('model') or 'unknown'
        bm = by_model.setdefault(m, {'model': m,'tokens':0,'sessions':0,'cost':0.0})
        bm['tokens'] += ttl; bm['sessions'] += 1; bm['cost'] += cost
        sc = d.get('source') or 'hermes'
        bs = by_source.setdefault(sc, {'source': sc,'tokens':0,'sessions':0})
        bs['tokens'] += ttl; bs['sessions'] += 1

# Fill the daily series so the chart has even spacing even on idle days.
ordered = []
for i in range(DAYS-1, -1, -1):
    day = (now - datetime.timedelta(days=i)).strftime('%Y-%m-%d')
    ordered.append(daily.get(day) or {'date': day,'input':0,'output':0,'total':0,'cost':0.0,'sessions':0})

top_models = sorted(by_model.values(), key=lambda x: x['tokens'], reverse=True)[:8]
top_sources = sorted(by_source.values(), key=lambda x: x['tokens'], reverse=True)[:8]
for r in totals, last24h:
    r['cost'] = round(r['cost'], 4)
for d in ordered:
    d['cost'] = round(d['cost'], 4)
for m in top_models: m['cost'] = round(m['cost'], 4)

print(json.dumps({
  'totals': totals, 'last24h': last24h, 'daily': ordered,
  'hourly': hourly, 'weekday': weekday,
  'topModels': top_models, 'topSources': top_sources, 'windowDays': DAYS,
}, ensure_ascii=False))`;

  try {
    const { stdout } = await execFileAsync('python3', ['-c', script], { timeout: 12000 });
    return JSON.parse(stdout) as TokenStats;
  } catch {
    return {
      totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, sessions: 0, apiCalls: 0, cost: 0 },
      last24h: { input: 0, output: 0, total: 0, sessions: 0, cost: 0 },
      daily: [], hourly: Array(24).fill(0), weekday: Array(7).fill(0),
      topModels: [], topSources: [], windowDays: safeDays,
    };
  }
}

type TerminalActionSpec = TerminalAction & {
  build: (req: Required<Pick<TerminalRunRequest, 'profileId'>>) => { file: string; args: string[] } | { synthetic: () => Promise<{ stdout: string; stderr?: string }> };
};

const terminalActions: TerminalActionSpec[] = [
  { id: 'hermes.version', label: 'Hermes 版本', description: '显示当前 Hermes CLI 版本。', commandPreview: 'hermes --version', category: 'hermes', maxTimeoutMs: 8000, build: () => ({ file: 'hermes', args: ['--version'] }) },
  { id: 'hermes.profile.list', label: 'Profile 列表', description: '列出 Hermes profiles，用于 Agent/执行上下文切换。', commandPreview: 'hermes profile list', category: 'hermes', maxTimeoutMs: 10000, build: () => ({ file: 'hermes', args: ['profile', 'list'] }) },
  { id: 'hermes.profile.show', label: '当前 Profile 详情', description: '显示当前或所选 profile 的配置摘要。', commandPreview: 'hermes profile show [profile]', category: 'hermes', profileAware: true, maxTimeoutMs: 10000, build: ({ profileId }) => ({ file: 'hermes', args: profileId && profileId !== 'default' ? ['profile', 'show', profileId] : ['profile', 'show'] }) },
  { id: 'hermes.tools.list', label: 'Tools 列表', description: '列出 Hermes 当前可用 toolsets。', commandPreview: 'hermes tools list', category: 'hermes', maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['tools', 'list'] }) },
  { id: 'hermes.skills.list', label: 'Skills 列表', description: '列出 Hermes skills，输出会截断到安全长度。', commandPreview: 'hermes skills list', category: 'hermes', maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['skills', 'list'] }) },
  { id: 'system.cwd', label: '运行目录', description: '显示 HermesDeck 服务当前工作目录和 Node 运行信息。', commandPreview: 'node process snapshot', category: 'system', maxTimeoutMs: 3000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify({ cwd: process.cwd(), node: process.version, platform: process.platform, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) }, null, 2) }) }) },
  { id: 'diagnostic.health', label: 'Deck 健康检查', description: '执行 HermesDeck BFF 健康检查，包含 API Server / Dashboard 状态。', commandPreview: 'HermesDeck health snapshot', category: 'diagnostic', maxTimeoutMs: 5000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify(await getHealth(), null, 2) }) }) },
];

function clampTimeout(input: unknown, max: number) {
  const n = Number(input || 8000);
  return Math.max(1000, Math.min(Number.isFinite(n) ? n : 8000, max, 15000));
}

function validateProfileId(input: unknown) {
  const id = String(input || 'default');
  if (!/^[\w.-]{1,64}$/.test(id)) throw new Error('Invalid profileId');
  return id;
}

function limitOutput(value: string, max = 64000) {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max) + `\n\n[output truncated at ${max} chars]`, truncated: true };
}

function redactSecrets(text: string) {
  return text
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)['\"]?[^\s'\",}]+/gi, '$1[REDACTED]')
    .replace(/(["'](?:api[_-]?key|token|secret|password)["']\s*:\s*)["'][^"']+["']/gi, '$1"[REDACTED]"')
    .replace(/(sk-[A-Za-z0-9]{12,})/g, '[REDACTED]');
}

export function listTerminalActions(): TerminalAction[] {
  return terminalActions.map(({ build: _build, ...action }) => action);
}

export async function runTerminalAction(body: TerminalRunRequest): Promise<TerminalRunResult> {
  const actionId = String(body?.actionId || '');
  const spec = terminalActions.find((a) => a.id === actionId);
  if (!spec) throw new Error('Unknown terminal action');
  const profileId = validateProfileId(body.profileId);
  const timeout = clampTimeout(body.timeoutMs, spec.maxTimeoutMs);
  const startedAtMs = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;
  let error: string | undefined;
  try {
    const built = spec.build({ profileId });
    if ('synthetic' in built) {
      const out = await built.synthetic();
      stdout = out.stdout;
      stderr = out.stderr || '';
    } else {
      const result = await execFileAsync(built.file, built.args, { timeout, maxBuffer: 256 * 1024, shell: false, env: { ...process.env, HERMES_PROFILE: profileId } });
      stdout = result.stdout;
      stderr = result.stderr;
    }
  } catch (e: any) {
    exitCode = typeof e?.code === 'number' ? e.code : null;
    stdout = e?.stdout || '';
    stderr = e?.stderr || '';
    error = e instanceof Error ? e.message : String(e);
  }
  const out = limitOutput(redactSecrets(stdout));
  const err = limitOutput(redactSecrets(stderr));
  return {
    ok: !error && (exitCode === 0 || exitCode === null),
    actionId: spec.id,
    label: spec.label,
    commandPreview: spec.commandPreview,
    startedAt: startedAtMs,
    durationMs: Date.now() - startedAtMs,
    exitCode,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    error: error ? redactSecrets(error) : undefined,
  };
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function formatAttachmentBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface NormalizedAttachment {
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image';
  text?: string;
  dataUrl?: string;
}

function normalizeAttachments(input: unknown): NormalizedAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: NormalizedAttachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const kind = a.kind === 'image' ? 'image' : a.kind === 'text' ? 'text' : null;
    if (!kind) continue;
    const name = typeof a.name === 'string' ? a.name : 'attachment';
    const mime = typeof a.mime === 'string' ? a.mime : '';
    const size = typeof a.size === 'number' ? a.size : 0;
    if (kind === 'text' && typeof a.text === 'string' && a.text.trim()) {
      out.push({ kind, name, mime, size, text: a.text });
    } else if (kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:')) {
      out.push({ kind, name, mime, size, dataUrl: a.dataUrl });
    }
  }
  return out;
}

function buildPromptWithAttachments(message: string, atts: NormalizedAttachment[]): string {
  const textAtts = atts.filter((a) => a.kind === 'text');
  if (!textAtts.length) return message;
  const blocks = textAtts.map((a) => {
    const header = `Attached file: ${a.name} (${a.mime || 'unknown'}, ${formatAttachmentBytes(a.size)})`;
    return `<<<<<< ${header}\n${a.text}\n>>>>>> end of ${a.name}`;
  });
  // Annotate image attachments as text hints too — useful when the model is
  // not multimodal but we still want it to know an image was attached.
  const imageAtts = atts.filter((a) => a.kind === 'image');
  const imageHints = imageAtts.map(
    (a) => `Attached image: ${a.name} (${a.mime || 'image/*'}, ${formatAttachmentBytes(a.size)})`,
  );
  const prefix = [...blocks, ...imageHints].join('\n\n');
  return prefix + (message ? '\n\n' + message : '');
}

export function createChatStream(body: any): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      sendSse(controller, 'status', { phase: 'connecting', backend: 'hermes-api-server' });
      const message = String(body?.message || '');
      const profile = String(body?.profileId || 'default');
      const model = body?.model ? String(body.model) : undefined;
      const previousResponseId = body?.previousResponseId ? String(body.previousResponseId) : undefined;
      const requestedSessionId = body?.sessionId ? String(body.sessionId) : undefined;
      const attachments = normalizeAttachments(body?.attachments);
      const hasImages = attachments.some((a) => a.kind === 'image');
      const enrichedMessage = buildPromptWithAttachments(message, attachments);
      try {
        // For multimodal turns we send an OpenAI Responses-style input array;
        // otherwise keep the simple string form for max backend compatibility.
        // Hermes' api_server normalizes both `input_image` and `image_url`
        // parts and accepts `image_url` as either a string or `{url, detail}`
        // object — we use the object form because it's what most upstream
        // providers expect when Hermes proxies the call.
        const inputForApi: unknown = hasImages
          ? [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: enrichedMessage },
                  ...attachments
                    .filter((a) => a.kind === 'image' && a.dataUrl)
                    .map((a) => ({
                      type: 'input_image',
                      image_url: { url: a.dataUrl as string, detail: 'auto' },
                    })),
                ],
              },
            ]
          : enrichedMessage;
        const apiBody: Record<string, unknown> = { input: inputForApi, stream: true };
        if (model) apiBody.model = model;
        if (previousResponseId) apiBody.previous_response_id = previousResponseId;
        const reqHeaders = { ...apiHeaders() } as Record<string, string>;
        // X-Hermes-Session-Id is only honored when an API key is configured
        // (api_server returns 403 otherwise to prevent unauthenticated session
        // hijacking). Skip the header when no key is set; the frontend will
        // reconcile its optimistic id against the X-Hermes-Session-Id we read
        // off the response header.
        if (requestedSessionId && reqHeaders.Authorization) {
          reqHeaders['X-Hermes-Session-Id'] = requestedSessionId;
        }
        const response = await fetch(`${HERMES_API_BASE}/v1/responses`, {
          method: 'POST', headers: reqHeaders, body: JSON.stringify(apiBody), signal: AbortSignal.timeout(Number(body?.timeoutMs || 180000)),
        });
        if (!response.ok || !response.body) throw new Error(`Hermes API Server /v1/responses failed: ${response.status} ${await response.text().catch(()=> '')}`);
        const sessionId = response.headers.get('X-Hermes-Session-Id') || requestedSessionId || '';
        sendSse(controller, 'status', { phase: 'streaming', backend: 'hermes-api-server', profile, sessionId: sessionId || undefined });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        let responseId = '';
        let buf = '';
        const consume = (block: string) => {
          const dataLines = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
          if (!dataLines.length) return;
          const raw = dataLines.join('\n');
          if (raw === '[DONE]') return;
          try {
            const obj = JSON.parse(raw);
            const type = obj.type || obj.event || '';
            const delta = String(type).includes('delta')
              ? (obj.delta || obj.output_text_delta || obj?.choices?.[0]?.delta?.content)
              : obj?.choices?.[0]?.delta?.content;
            const candidateResponseId = obj?.response?.id || obj?.item?.id || (String(type).startsWith('response.') ? obj.id : undefined);
            if (candidateResponseId && !responseId) responseId = String(candidateResponseId);
            if (delta) { full += String(delta); sendSse(controller, 'delta', { delta: String(delta) }); }
            sendSse(controller, 'run-event', { type: type || 'api.event', payload: obj, ts: Date.now() });
          } catch { if (raw) { full += raw; sendSse(controller, 'delta', { delta: raw }); } }
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n'); buf = blocks.pop() || '';
          blocks.forEach(consume);
        }
        if (buf.trim()) consume(buf);
        sendSse(controller, 'done', { ok: true, backend: 'hermes-api-server', content: full.trim(), responseId: responseId || undefined, sessionId: sessionId || undefined });
        controller.close();
        // Tag the session as deck-originated AFTER the agent has flushed its
        // session row + messages. Fire-and-forget so the close above isn't
        // delayed; the UPDATE runs on the next event-loop tick.
        if (sessionId) { void tagSessionSource(sessionId, 'hermesdeck', profile); }
      } catch (apiError) {
        const reason = apiError instanceof Error ? apiError.message : String(apiError);
        // The CLI fallback path strips images entirely (`hermes chat -q` only
        // takes text). Falling back silently when images are present means
        // the agent answers as if no image was sent — which is exactly the
        // bug we're fixing. Surface the API error so the user sees what
        // happened and can shrink the image / fix the model.
        if (hasImages) {
          sendSse(controller, 'error', {
            error: `图片对话失败：${reason}`,
            backend: 'hermes-api-server',
          });
          controller.close();
          return;
        }
        sendSse(controller, 'status', { phase: 'fallback-cli', backend: 'hermes-cli', reason });
        const args = ['chat'];
        if (profile && profile !== 'default') args.push('--profile', profile);
        // Text attachments are already inlined into enrichedMessage so they
        // survive this path; images would have triggered the early return above.
        args.push('-q', enrichedMessage, '-Q', '--source', 'hermesdeck');
        const child = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let full = ''; let err = '';
        child.stdout.on('data', (chunk) => { const delta = chunk.toString(); full += delta; sendSse(controller, 'delta', { delta }); });
        child.stderr.on('data', (chunk) => { err += chunk.toString(); sendSse(controller, 'run-event', { type: 'stderr', payload: chunk.toString(), ts: Date.now() }); });
        child.on('error', (e) => { sendSse(controller, 'error', { error: e.message }); controller.close(); });
        child.on('close', (code) => {
          if (code === 0) sendSse(controller, 'done', { ok: true, backend: 'hermes-cli-fallback', content: full.trim(), stderr: err.slice(-1000) });
          else sendSse(controller, 'error', { error: `hermes exited with code ${code}`, stderr: err.slice(-2000) });
          controller.close();
        });
      }
    }
  });
}

export function newId(prefix = 'local') { return `${prefix}_${randomUUID()}`; }
