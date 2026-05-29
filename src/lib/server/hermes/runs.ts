import type { DeckRun, DeckRunDetail } from '@/lib/types';
import { runPython } from '../run-python';
import { PROFILE_ID_RE } from './core';

// ─── Runs (derived from messages) ───────────────────────────────────
// Hermes records every agent turn as a message row. We bucket consecutive
// messages within a session into "runs" using user messages as the boundary
// — each user message starts a new run that includes all subsequent
// assistant + tool messages until the next user message (or end of session).

// Run id: `run::<profile>::<sessionId>::<index>`. The double-colon delimiter
// is unambiguous (profile/session ids may legally contain `_` and `-` but
// never `::`), so we can split safely without needing a regex with greedy
// captures. We still accept the legacy `run_<profile>_<sid>_<idx>` form for
// any clients/cache holding old IDs.
// Legacy retention / sunset: keep decoding the old form while run detail links
// may be cached in browser history or copied from pre-delimiter Deck builds.
function buildRunsScript(filter: string): string {
  return String.raw`
import sqlite3, json, os, pathlib, datetime
home = pathlib.Path.home() / '.hermes'
profiles = []
default_db = home / 'state.db'
if default_db.exists(): profiles.append(('default', default_db))
profiles_dir = home / 'profiles'
if profiles_dir.exists():
    for d in sorted(profiles_dir.iterdir()):
        if not d.is_dir(): continue
        db = d / 'state.db'
        if db.exists(): profiles.append((d.name, db))

def to_iso(v):
    if v in (None, ''): return ''
    # Numeric (unix epoch float) or numeric-string → convert to ISO Z.
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        pass
    s = str(v)
    if not s: return ''
    # Already an ISO-ish string ('2026-04-30T15:14:14.123456[+00:00]Z')
    if 'T' in s or '-' in s:
        # Normalize trailing tz so the frontend Date.parse() works consistently.
        if s.endswith('Z'): return s
        if '+' in s.split('T', 1)[-1]: return s.replace('+00:00', 'Z')
        return s + 'Z' if 'T' in s else s
    return s

def first_text(content):
    if content is None: return ''
    if isinstance(content, (int, float)): return str(content)
    s = str(content)
    if s.startswith('['):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                for p in parsed:
                    if isinstance(p, dict) and (p.get('type') in ('text','input_text','output_text')) and p.get('text'):
                        return str(p['text'])
        except Exception: pass
    return s

runs = []
${filter}
print(json.dumps(runs, ensure_ascii=False))`;
}

const RUNS_FILTER = String.raw`
LIMIT_RUNS = 80
SESSION_SCAN_CAP = 200
for pid, db in profiles:
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        con.row_factory = sqlite3.Row
        mcols = [r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
        scols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
        if not mcols or not scols: con.close(); continue
        session_col = 'session_id' if 'session_id' in mcols else ('conversation_id' if 'conversation_id' in mcols else None)
        if not session_col or 'role' not in mcols: con.close(); continue
        # Hermes uses 'timestamp' (newer schema) — older builds had 'created_at'.
        ts_col = 'timestamp' if 'timestamp' in mcols else ('created_at' if 'created_at' in mcols else None)
        order_col = ts_col or ('id' if 'id' in mcols else session_col)
        # Bound the scan to the most-recently-active sessions. Without this a
        # large history forces an O(all messages) transfer into Python and the
        # route times out — degrading /runs back to an empty list.
        if ts_col:
            recent_ids = [str(r[0]) for r in con.execute(
                f"select {session_col} from messages where {session_col} is not null "
                f"group by {session_col} order by max({ts_col}) desc limit {SESSION_SCAN_CAP}"
            ).fetchall()]
        else:
            recent_ids = [str(r[0]) for r in con.execute(
                f"select distinct {session_col} from messages where {session_col} is not null "
                f"limit {SESSION_SCAN_CAP}"
            ).fetchall()]
        if not recent_ids: con.close(); continue
        ph = ','.join('?' * len(recent_ids))
        # Pull session metadata for just those sessions.
        sess_select = [c for c in ('id','title','source','model') if c in scols]
        sess_index = {}
        if 'id' in scols and sess_select:
            for r in con.execute(
                f"select {', '.join(sess_select)} from sessions where id in ({ph})", recent_ids
            ).fetchall():
                d = dict(r); sess_index[str(d.get('id'))] = d
        cols_sel = [c for c in (session_col, 'role', 'content', 'tool_name', 'tool_calls', 'id') if c in mcols]
        if ts_col: cols_sel.append(ts_col)
        rows = con.execute(
            f"select {', '.join(cols_sel)} from messages where {session_col} in ({ph}) "
            f"order by {session_col}, {order_col}", recent_ids
        ).fetchall()
        # Group by session
        by_session = {}
        for r in rows:
            d = dict(r); sid = str(d.get(session_col) or '')
            if not sid: continue
            by_session.setdefault(sid, []).append(d)
        # Build runs: each user message starts a run. Track per-session
        # run index so the run id is stable across calls (matches getRunDetail's
        # decoder).
        for sid, msgs in by_session.items():
            sess = sess_index.get(sid, {})
            cur_run = None
            run_idx = -1
            for m in msgs:
                role = (m.get('role') or '').lower()
                ts_val = m.get(ts_col) if ts_col else None
                if role == 'user':
                    if cur_run is not None: runs.append(cur_run)
                    run_idx += 1
                    cur_run = {
                        'id': f"run::{pid}::{sid}::{run_idx}",
                        'sessionId': sid,
                        'sessionTitle': sess.get('title') or '',
                        'profileId': pid,
                        'model': sess.get('model') or '',
                        'source': sess.get('source') or 'hermes',
                        'startedAt': to_iso(ts_val),
                        'endedAt': to_iso(ts_val),
                        'toolCallCount': 0,
                        'toolNames': [],
                        'promptPreview': first_text(m.get('content'))[:120],
                        'replyPreview': '',
                        'status': 'running',
                        'errorSummary': '',
                    }
                    continue
                if cur_run is None: continue
                end_ts = to_iso(ts_val)
                if end_ts: cur_run['endedAt'] = end_ts
                if role == 'assistant':
                    txt = first_text(m.get('content'))
                    if txt:
                        cur_run['replyPreview'] = txt[:120]
                        cur_run['status'] = 'success'
                    if m.get('tool_calls'):
                        try:
                            tc = json.loads(m['tool_calls']) if isinstance(m['tool_calls'], str) else m['tool_calls']
                            if isinstance(tc, list):
                                for entry in tc:
                                    if not isinstance(entry, dict): continue
                                    fn = entry.get('function') if isinstance(entry.get('function'), dict) else {}
                                    nm = fn.get('name') or entry.get('name')
                                    if nm:
                                        cur_run['toolCallCount'] += 1
                                        if nm not in cur_run['toolNames']: cur_run['toolNames'].append(nm)
                        except Exception: pass
                elif role == 'tool':
                    cur_run['toolCallCount'] += 1
                    nm = m.get('tool_name')
                    if nm and nm not in cur_run['toolNames']: cur_run['toolNames'].append(nm)
                    txt = first_text(m.get('content'))
                    if txt and txt.lower().startswith('error'):
                        cur_run['status'] = 'failed'
                        cur_run['errorSummary'] = txt[:160]
            if cur_run is not None: runs.append(cur_run)
        con.close()
    except Exception:
        pass
# Sort by startedAt desc; cap to LIMIT_RUNS
runs.sort(key=lambda r: r.get('startedAt') or '', reverse=True)
runs = runs[:LIMIT_RUNS]
# Compute durationMs
for r in runs:
    s = r.get('startedAt'); e = r.get('endedAt')
    if not s or not e: continue
    try:
        st = datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
        en = datetime.datetime.fromisoformat(e.replace('Z','+00:00'))
        r['durationMs'] = max(0, int((en - st).total_seconds() * 1000))
    except Exception: pass
`;

export async function getRuns(profile?: string): Promise<DeckRun[]> {
  // Narrow the embedded Python's profile list via env var rather than
  // string-templating the profile name into the script body. We validate the
  // id here too, but defense-in-depth: if PROFILE_ID_RE were ever weakened,
  // the env-var path can't escape into Python source.
  const safeProfile = profile && PROFILE_ID_RE.test(profile) ? profile : '';
  const profileFilter = safeProfile
    ? `\n_pf = os.environ.get('PROFILE_FILTER', '')\nif _pf:\n    profiles = [(p, db) for (p, db) in profiles if p == _pf]`
    : '';
  const r = await runPython<DeckRun[]>(buildRunsScript(profileFilter + RUNS_FILTER), {
    timeoutMs: 15000,
    env: safeProfile ? ({ PROFILE_FILTER: safeProfile } as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv) : undefined,
  });
  if (!r.ok) throw new Error(`getRuns failed: ${r.error}`);
  return Array.isArray(r.value) ? r.value : [];
}

export async function getRunDetail(runId: string): Promise<DeckRunDetail | null> {
  // Preferred id format: run::<profile>::<sessionId>::<index>. Legacy form:
  // run_<profile>_<sid>_<idx> — decoded only when the profile contains no
  // underscores (legacy parser was unable to disambiguate otherwise).
  let profile = '';
  let sessionId = '';
  let idxStr = '';
  if (runId.startsWith('run::')) {
    const parts = runId.slice(5).split('::');
    if (parts.length < 3) return null;
    idxStr = parts.pop()!;
    profile = parts.shift()!;
    sessionId = parts.join('::');
  } else {
    // Legacy retention / sunset: decode old copied/cached run_<profile>_<sid>_<idx>
    // URLs, but only for the unambiguous no-underscore profile case documented
    // above. Do not broaden this parser without changing the legacy id format.
    const m = runId.match(/^run_([^_]+)_(.+)_(\d+)$/);
    if (!m) return null;
    [, profile, sessionId, idxStr] = m;
  }
  if (!PROFILE_ID_RE.test(profile)) return null;
  if (!/^[\w.:/+=-]{1,256}$/.test(sessionId)) return null;
  const idx = Math.max(0, Math.min(999, parseInt(idxStr, 10) || 0));
  const script = String.raw`
import sqlite3, json, os, pathlib, datetime, sys
profile = os.environ.get('PROFILE','default')
sid = os.environ.get('SID','')
target_idx = int(os.environ.get('IDX','0'))
home = pathlib.Path.home() / '.hermes'
db = home / 'state.db' if profile == 'default' else home / 'profiles' / profile / 'state.db'
if not db.exists(): print('null'); sys.exit(0)
def to_iso(v):
    if v in (None, ''): return ''
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError): pass
    s = str(v)
    if not s: return ''
    if 'T' in s and not s.endswith('Z') and '+' not in s.split('T',1)[-1]:
        return s + 'Z'
    return s.replace('+00:00','Z')
def first_text(c):
    if c is None: return ''
    s = str(c)
    if s.startswith('['):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                parts = []
                for p in parsed:
                    if isinstance(p, dict) and (p.get('type') in ('text','input_text','output_text')) and p.get('text'):
                        parts.append(str(p['text']))
                if parts: return '\n\n'.join(parts)
        except Exception: pass
    return s
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True); con.row_factory = sqlite3.Row
mcols = [r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
scols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
session_col = 'session_id' if 'session_id' in mcols else ('conversation_id' if 'conversation_id' in mcols else None)
if not session_col: print('null'); sys.exit(0)
ts_col = 'timestamp' if 'timestamp' in mcols else ('created_at' if 'created_at' in mcols else None)
order_col = ts_col or ('id' if 'id' in mcols else session_col)
cols_sel = [c for c in (session_col, 'role', 'content', 'tool_name', 'tool_call_id', 'tool_calls', 'id') if c in mcols]
if ts_col: cols_sel.append(ts_col)
rows = con.execute(f"select {', '.join(cols_sel)} from messages where {session_col}=? order by {order_col}", (sid,)).fetchall()
sess = None
if 'id' in scols:
    sess_sel = [c for c in ('id','title','source','model') if c in scols]
    r = con.execute(f"select {', '.join(sess_sel)} from sessions where id=?", (sid,)).fetchone()
    if r: sess = dict(r)
# Build runs
runs = []
cur = None
for r in rows:
    d = dict(r); role = (d.get('role') or '').lower()
    ts_val = d.get(ts_col) if ts_col else None
    if role == 'user':
        if cur is not None: runs.append(cur)
        cur = {'events': [], 'startedAt': to_iso(ts_val), 'endedAt': to_iso(ts_val),
               'promptPreview': first_text(d.get('content'))[:120], 'replyPreview': '',
               'status': 'running', 'toolCallCount': 0, 'toolNames': [], 'errorSummary': ''}
    if cur is None: continue
    end_ts = to_iso(ts_val)
    if end_ts: cur['endedAt'] = end_ts
    tool_calls = []
    if d.get('tool_calls'):
        try:
            tc = json.loads(d['tool_calls']) if isinstance(d['tool_calls'], str) else d['tool_calls']
            if isinstance(tc, list):
                for entry in tc:
                    if not isinstance(entry, dict): continue
                    fn = entry.get('function') if isinstance(entry.get('function'), dict) else {}
                    tool_calls.append({'id': entry.get('id') or entry.get('call_id'), 'name': fn.get('name') or entry.get('name'), 'arguments': fn.get('arguments') or entry.get('arguments')})
                    nm = fn.get('name') or entry.get('name')
                    if nm:
                        cur['toolCallCount'] += 1
                        if nm not in cur['toolNames']: cur['toolNames'].append(nm)
        except Exception: pass
    if role == 'tool':
        cur['toolCallCount'] += 1
        nm = d.get('tool_name')
        if nm and nm not in cur['toolNames']: cur['toolNames'].append(nm)
        txt = first_text(d.get('content'))
        if txt and txt.lower().startswith('error'):
            cur['status'] = 'failed'; cur['errorSummary'] = txt[:160]
    elif role == 'assistant':
        txt = first_text(d.get('content'))
        if txt:
            cur['replyPreview'] = txt[:120]
            if cur['status'] == 'running': cur['status'] = 'success'
    cur['events'].append({
        'id': str(d.get('id') or len(cur['events'])),
        'role': d.get('role') or 'assistant',
        'content': d.get('content') or '',
        'createdAt': to_iso(ts_val),
        'toolName': d.get('tool_name') or '',
        'toolCallId': d.get('tool_call_id') or '',
        'toolCalls': tool_calls,
    })
if cur is not None: runs.append(cur)
con.close()
if target_idx >= len(runs): print('null'); sys.exit(0)
out = runs[target_idx]
out['id'] = f"run::{profile}::{sid}::{target_idx}"
out['sessionId'] = sid
out['profileId'] = profile
if sess:
    out['sessionTitle'] = sess.get('title') or ''
    out['model'] = sess.get('model') or ''
    out['source'] = sess.get('source') or 'hermes'
# Compute duration
try:
    st = datetime.datetime.fromisoformat(out['startedAt'].replace('Z','+00:00'))
    en = datetime.datetime.fromisoformat(out['endedAt'].replace('Z','+00:00'))
    out['durationMs'] = max(0, int((en - st).total_seconds() * 1000))
except Exception: pass
print(json.dumps(out, ensure_ascii=False))`;
  const r = await runPython<DeckRunDetail | null>(script, {
    timeoutMs: 12000,
    env: { ...process.env, PROFILE: profile, SID: sessionId, IDX: String(idx) },
  });
  if (!r.ok) throw new Error(`getRunDetail failed: ${r.error}`);
  return r.value;
}
