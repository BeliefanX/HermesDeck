import type { DeckSession } from '@/lib/types';
import { runPython } from '../run-python';
import { execFileAsync, PROFILE_ID_RE } from './core';

export async function getSessions(profile = 'default'): Promise<DeckSession[]> {
  // The profile id is interpolated into a `pathlib` path inside the embedded
  // Python (home/'profiles'/profile/'state.db'). A value containing `../`
  // would escape ~/.hermes — coerce anything invalid to 'default', matching
  // tagSessionSource / getRuns / getRunDetail.
  if (!PROFILE_ID_RE.test(profile)) profile = 'default';
  const script = String.raw`
import sqlite3, json, os, pathlib, datetime
profile=os.environ.get('PROFILE','default')
home=pathlib.Path.home()/'.hermes'
if profile and profile!='default': home=home/'profiles'/profile
state=home/'state.db'
out=[]
def to_iso(v):
  # Hermes state.db stores started_at/ended_at as Unix epoch floats. Older rows
  # or alternate schemas may carry ISO strings. Stringifying the float directly
  # makes Date.parse() in the browser return NaN, which breaks the 24h heatmap
  # and any other client-side time bucketing.
  if v is None or v == '': return ''
  if isinstance(v, (int, float)):
    try: return datetime.datetime.fromtimestamp(float(v), tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except Exception: return ''
  s = str(v).strip()
  if not s: return ''
  # Numeric string ('1777638390.66') — same epoch handling.
  try:
    f = float(s)
    if f > 10_000_000:
      return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
  except Exception: pass
  return s
if state.exists():
  con=sqlite3.connect(state)
  con.row_factory=sqlite3.Row
  cols=[r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
  sel=[]
  for c in ['id','session_id','source','model','prompt','title','created_at','updated_at','started_at','ended_at','message_count','total_messages','parent_session_id']:
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
  # Latest message timestamp per session — gives the heatmap a true "last
  # activity" signal. The sessions schema only has started_at / ended_at;
  # ended_at is NULL for in-flight rows, so without this the heatmap collapses
  # an active multi-hour session to a single bucket at started_at.
  last_msg = {}
  if msg_session_col and 'created_at' in msg_cols:
    try:
      for mr in con.execute(f'select {msg_session_col} as sid, max(created_at) as ts from messages group by {msg_session_col}').fetchall():
        sid_k = str(mr['sid']) if mr['sid'] is not None else ''
        if sid_k and mr['ts'] is not None: last_msg[sid_k] = mr['ts']
    except Exception:
      pass
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
    created_raw = d.get('created_at') or d.get('started_at')
    updated_raw = last_msg.get(sid) or d.get('updated_at') or d.get('ended_at') or d.get('started_at') or d.get('created_at')
    item = {'id':sid,'profileId':profile,'title':title,'source':d.get('source') or 'hermes','model':d.get('model') or '', 'createdAt':to_iso(created_raw), 'updatedAt':to_iso(updated_raw), 'messageCount':d.get('message_count') or d.get('total_messages') or 0}
    if parent: item['parentSessionId'] = str(parent)
    cc = child_counts.get(sid, 0)
    if cc: item['childCount'] = cc
    out.append(item)
print(json.dumps(out, ensure_ascii=False))`;
  const r = await runPython<DeckSession[]>(script, { timeoutMs: 10000, env: { ...process.env, PROFILE: profile } });
  if (!r.ok) throw new Error(`getSessions failed: ${r.error}`);
  return r.value;
}

export async function tagSessionSource(sessionId: string, source: string, profile = 'default'): Promise<void> {
  // Re-stamp the session row's `source` column. api_server hardcodes
  // source='api_server' on creation; we use this to mark deck-originated
  // chats as 'hermesdeck' so they're distinguishable from CLI / external
  // /v1/responses callers in every device that reads state.db.
  if (!sessionId || !source) return;
  // Validate the profile id before any FS use — a `../../etc` value would
  // otherwise probe filesystem existence via the embedded Python.
  const safeProfile = PROFILE_ID_RE.test(profile) ? profile : 'default';
  profile = safeProfile;
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
    // Tagging is best-effort.
  }
}

export async function deleteSession(sessionId: string, profile = 'default'): Promise<{ ok: boolean; removed: number }> {
  // Validate the profile before it reaches the embedded Python's path join —
  // this deletes rows, so an unvalidated `../` traversal would be worse than a
  // read. Invalid ids fall back to 'default' (consistent with getSessions).
  if (!PROFILE_ID_RE.test(profile)) profile = 'default';
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
  const r = await runPython<{ ok: boolean; removed: number }>(script, {
    timeoutMs: 10000,
    env: { ...process.env, PROFILE: profile, SID: sessionId },
  });
  if (!r.ok) throw new Error(`deleteSession failed: ${r.error}`);
  return r.value;
}
