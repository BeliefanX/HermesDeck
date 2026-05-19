import type { DeckProfile } from '@/lib/types';
import { runPythonOr } from '../run-python';
import { execFileAsync, makeCache } from './core';

async function getProfileActivity(profileIds: string[]): Promise<Record<string, { sessionCount: number; lastActiveAt: string }>> {
  if (!profileIds.length) return {};
  // Each profile keeps its own state.db at ~/.hermes/state.db (default) or
  // ~/.hermes/profiles/<id>/state.db (named). We aggregate session count and
  // the latest activity timestamp (max of started_at and last message
  // created_at) so the deck can show "X sessions · last active 2h ago" without
  // touching any Hermes config.
  const script = String.raw`
import sqlite3, json, os, pathlib, datetime
ids = json.loads(os.environ.get('IDS','[]'))
home = pathlib.Path.home() / '.hermes'
out = {}
def to_iso(v):
    if v in (None, ''): return ''
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        pass
    return str(v)
for pid in ids:
    db = home / 'state.db' if pid == 'default' else home / 'profiles' / pid / 'state.db'
    info = {'sessionCount': 0, 'lastActiveAt': ''}
    if not db.exists():
        out[pid] = info; continue
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        sess_cols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
        if not sess_cols:
            out[pid] = info; con.close(); continue
        info['sessionCount'] = int(con.execute('select count(*) from sessions').fetchone()[0] or 0)
        candidates = []
        for c in ('updated_at','ended_at','started_at','created_at'):
            if c in sess_cols:
                v = con.execute(f'select max({c}) from sessions').fetchone()[0]
                if v: candidates.append(v)
        msg_cols = [r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
        if 'created_at' in msg_cols:
            v = con.execute('select max(created_at) from messages').fetchone()[0]
            if v: candidates.append(v)
        if candidates:
            best = ''
            for c in candidates:
                iso = to_iso(c)
                if iso > best: best = iso
            info['lastActiveAt'] = best
        con.close()
    except Exception:
        pass
    out[pid] = info
print(json.dumps(out, ensure_ascii=False))`;
  return runPythonOr<Record<string, { sessionCount: number; lastActiveAt: string }>>(
    script,
    {},
    { timeoutMs: 8000, env: { ...process.env, IDS: JSON.stringify(profileIds) } },
  );
}

async function getProfilesUncached(): Promise<DeckProfile[]> {
  // `profile show` and `profile list` are independent — running them in
  // parallel halves wall-clock latency on a cold call.
  const [showRes, listRes] = await Promise.allSettled([
    execFileAsync('hermes', ['profile', 'show'], { timeout: 8000 }),
    execFileAsync('hermes', ['profile', 'list'], { timeout: 10000 }),
  ]);
  let active = 'default';
  if (showRes.status === 'fulfilled') {
    const m = showRes.value.stdout.match(/(?:Active profile|Profile)[:\s]+([\w.-]+)/i);
    if (m) active = m[1];
  }
  let profiles: DeckProfile[] = [];
  if (listRes.status === 'fulfilled') {
    const { stdout } = listRes.value;
    const rows = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
    profiles = Array.from(new Map(profiles.map((p) => [p.id, p])).values());
  }
  if (!profiles.length) profiles = [{ id: 'default', name: 'default', active: true, toolsets: [] }];

  const activity = await getProfileActivity(profiles.map((p) => p.id));
  return profiles.map((p) => {
    const a = activity[p.id];
    return a ? { ...p, sessionCount: a.sessionCount, lastActiveAt: a.lastActiveAt || undefined } : p;
  });
}

export const getProfiles = makeCache(5_000, getProfilesUncached);
