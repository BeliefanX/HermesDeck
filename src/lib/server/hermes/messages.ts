import type { DeckMessage } from '@/lib/types';
import { runPython } from '../run-python';
import { PROFILE_ID_RE } from './core';

export interface GetMessagesOptions {
  /** Maximum number of messages to return; clamped to [1, 1000]. */
  limit?: number;
  /** ISO timestamp — only return messages strictly older than this. */
  before?: string;
}

export async function getMessages(sessionId: string, profile = 'default', opts: GetMessagesOptions = {}): Promise<DeckMessage[]> {
  // The profile id is interpolated into a `pathlib` path inside the embedded
  // Python — coerce anything invalid to 'default' to block `../` traversal.
  if (!PROFILE_ID_RE.test(profile)) profile = 'default';
  const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 1000)));
  const before = typeof opts.before === 'string' && opts.before ? opts.before : '';
  const script = String.raw`
import sqlite3, json, os, pathlib, datetime
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
      # Hermes' newer schema stores message time in 'timestamp'; older builds
      # used 'created_at'. Probe both — this query previously only knew
      # 'created_at', so on the newer schema every message came back with a
      # blank createdAt and was ordered by rowid instead of time.
      # Legacy retention / sunset: keep the 'created_at' probe while existing
      # user state.db files from pre-timestamp Hermes builds remain readable.
      ts_col='timestamp' if 'timestamp' in cols else ('created_at' if 'created_at' in cols else None)
      order=ts_col or ('id' if 'id' in cols else session_col)
      def to_iso(v):
        if v is None or v=='': return ''
        try:
          f=float(v)
          if f>10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
        except (TypeError, ValueError): pass
        s=str(v)
        if 'T' in s and not s.endswith('Z') and '+' not in s.split('T',1)[-1]: return s+'Z'
        return s.replace('+00:00','Z')
      def split_content(raw):
        # Hermes stores content either as a plain string (legacy / text-only
        # turns) or as a JSON array of OpenAI-Responses-style parts (text +
        # image + file). Split into a (joined_text, attachments[]) pair so the
        # frontend can render text and binary artifacts independently rather
        # than dumping the whole JSON blob into the markdown bubble.
        # Legacy retention / sunset: the plain-string branch is permanent
        # backcompat for historical chat rows, not dead code.
        if raw is None: return ('', [])
        if isinstance(raw, (int, float)): return (str(raw), [])
        s = str(raw)
        if not s.startswith('['): return (s, [])
        try:
          parsed = json.loads(s)
        except Exception:
          return (s, [])
        if not isinstance(parsed, list): return (s, [])
        text_parts = []
        atts = []
        idx = 0
        def push_image(name, mime, data_url=None, url=None):
          nonlocal idx
          idx += 1
          a = {'id': f'h_{idx}', 'name': name or f'image-{idx}', 'mime': mime or 'image/png', 'size': 0, 'kind': 'image'}
          if data_url: a['dataUrl'] = data_url
          if url: a['url'] = url
          atts.append(a)
        def push_file(name, mime, data_url=None, url=None):
          nonlocal idx
          idx += 1
          a = {'id': f'h_{idx}', 'name': name or f'file-{idx}', 'mime': mime or 'application/octet-stream', 'size': 0, 'kind': 'file'}
          if data_url: a['dataUrl'] = data_url
          if url: a['url'] = url
          atts.append(a)
        for p in parsed:
          if not isinstance(p, dict): continue
          ptype = p.get('type') or ''
          if ptype in ('text','input_text','output_text') and p.get('text'):
            text_parts.append(str(p['text']))
            continue
          if ptype in ('output_image','image','input_image','image_url'):
            iu = p.get('image_url')
            url = None; data_url = None
            if isinstance(iu, str): url = iu
            elif isinstance(iu, dict) and isinstance(iu.get('url'), str): url = iu.get('url')
            if not url and isinstance(p.get('url'), str): url = p.get('url')
            b64 = p.get('b64_json') or p.get('image_b64')
            mime = p.get('mime') or p.get('mime_type') or ''
            name = p.get('name') or ''
            if isinstance(url, str) and url.startswith('data:'):
              push_image(name, mime, data_url=url)
            elif isinstance(url, str) and url:
              push_image(name, mime, url=url)
            elif isinstance(b64, str) and b64:
              fmt = p.get('output_format') or 'png'
              m = mime or f'image/{fmt}'
              push_image(name or f'image.{fmt}', m, data_url=f'data:{m};base64,{b64}')
            continue
          if ptype in ('file','output_file','input_file'):
            f = p.get('file') if isinstance(p.get('file'), dict) else p
            url = f.get('url') if isinstance(f.get('url'), str) else None
            data_url = f.get('dataUrl') if isinstance(f.get('dataUrl'), str) and f.get('dataUrl','').startswith('data:') else None
            mime = f.get('mime') or f.get('mime_type') or ''
            name = f.get('name') or f.get('filename') or 'file'
            is_image = mime.startswith('image/') if isinstance(mime, str) else False
            if is_image:
              push_image(name, mime, data_url=data_url, url=url)
            else:
              push_file(name, mime, data_url=data_url, url=url)
            continue
        joined = '\n\n'.join(text_parts) if text_parts else ''
        return (joined, atts)
      limit_n = int(os.environ.get('LIMIT','1000'))
      before_ts = os.environ.get('BEFORE','')
      where_extra = ''
      params = [sid]
      if before_ts and ts_col:
        # The ts column stores unix epoch floats; the cursor may arrive as an
        # ISO string. Comparing a numeric column against a TEXT operand always
        # evaluates the column as "less than", so a raw bind matches every row.
        before_epoch = None
        try:
          before_epoch = float(before_ts)
        except (TypeError, ValueError):
          try:
            before_epoch = datetime.datetime.fromisoformat(before_ts.replace('Z','+00:00')).timestamp()
          except Exception:
            before_epoch = None
        if before_epoch is not None:
          where_extra = f' and {ts_col} < ?'
          params.append(before_epoch)
      for r in con.execute(f'select * from messages where {session_col}=?'+where_extra+f' order by {order} desc limit {limit_n}', params).fetchall():
        d=dict(r)
        joined, atts = split_content(d.get(content_col))
        item={'id':str(d.get('id') or len(out)), 'role':d.get(role_col) or 'assistant', 'content':joined, 'createdAt':to_iso(d.get(ts_col) if ts_col else None)}
        if atts: item['attachments']=atts
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
out.reverse()
print(json.dumps(out, ensure_ascii=False))`;
  const r = await runPython<DeckMessage[]>(script, {
    timeoutMs: 10000,
    env: { ...process.env, PROFILE: profile, SID: sessionId, LIMIT: String(limit), BEFORE: before },
  });
  if (!r.ok) throw new Error(`getMessages failed: ${r.error}`);
  return r.value;
}
