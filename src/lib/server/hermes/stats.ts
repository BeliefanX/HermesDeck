import type { DeckStats } from '@/lib/types';
import { runPython } from '../run-python';
import { PROFILE_ID_RE } from './core';

// ─── Aggregate stats ────────────────────────────────────────────────
// Power the dashboard headline numbers. The previous implementation derived
// totals from a 200-session sample, which silently underestimated active
// users. This walks every profile's state.db and returns true totals plus
// 24h windows and per-profile / per-source breakdowns.

export async function getDeckStats(profile?: string): Promise<DeckStats> {
  // Validate + propagate profile filter through env var; the embedded Python
  // narrows the profile list before any sqlite work, so per-profile scope is
  // computed at the source rather than aggregated then filtered.
  const safeProfile = profile && PROFILE_ID_RE.test(profile) ? profile : '';
  const script = String.raw`
import sqlite3, json, pathlib, datetime, os
home = pathlib.Path.home() / '.hermes'
filter_profile = os.environ.get('PROFILE_FILTER', '')
empty = {
  'totalSessions': 0,
  'totalMessages': 0,
  'activeSessions24h': 0,
  'activeMessages24h': 0,
  'perProfile': [],
  'perSource': [],
  'lastActiveAt': '',
}
if not home.exists():
    print(json.dumps(empty)); raise SystemExit
profiles = []
default_db = home / 'state.db'
if default_db.exists():
    profiles.append(('default', default_db))
profiles_dir = home / 'profiles'
if profiles_dir.exists():
    for d in sorted(profiles_dir.iterdir()):
        if not d.is_dir(): continue
        db = d / 'state.db'
        if db.exists(): profiles.append((d.name, db))

if filter_profile:
    profiles = [(p, db) for (p, db) in profiles if p == filter_profile]

now = datetime.datetime.now(datetime.timezone.utc).timestamp()
cutoff = now - 24 * 3600

def to_iso(v):
    if v in (None, ''): return ''
    try:
        return datetime.datetime.fromtimestamp(float(v), tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        return str(v)

def parse_ts(v):
    if v in (None, ''): return None
    try: return float(v)
    except (TypeError, ValueError):
        try:
            s = str(v).split('+')[0].split('Z')[0]
            for fmt in ('%Y-%m-%dT%H:%M:%S.%f','%Y-%m-%dT%H:%M:%S','%Y-%m-%d %H:%M:%S.%f','%Y-%m-%d %H:%M:%S'):
                try: return datetime.datetime.strptime(s, fmt).replace(tzinfo=datetime.timezone.utc).timestamp()
                except Exception: pass
        except Exception: pass
    return None

agg = {
  'totalSessions': 0,
  'totalMessages': 0,
  'activeSessions24h': 0,
  'activeMessages24h': 0,
  'perProfile': [],
  'perSource': {},
  'lastActiveAt': '',
}
last_ts = 0.0
for pid, db in profiles:
    info = {'profileId': pid, 'sessions': 0, 'messages': 0, 'lastActiveAt': ''}
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        scols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
        if scols:
            sc = int(con.execute('select count(*) from sessions').fetchone()[0] or 0)
            info['sessions'] = sc
            agg['totalSessions'] += sc
            # Source breakdown + 24h window must reconcile with totalSessions,
            # so don't gate them on 'started_at' alone — probe any timestamp
            # column the schema has, and count source even when none exists.
            ts_sess_col = next((c for c in ('started_at','created_at','updated_at','ended_at') if c in scols), None)
            has_source = 'source' in scols
            read_cols = [c for c in (ts_sess_col, 'source' if has_source else None) if c]
            if read_cols:
                for row in con.execute(f"select {', '.join(read_cols)} from sessions").fetchall():
                    rec = dict(zip(read_cols, row))
                    if ts_sess_col:
                        ts = parse_ts(rec.get(ts_sess_col))
                        if ts and ts > last_ts: last_ts = ts
                        if ts and ts >= cutoff: agg['activeSessions24h'] += 1
                    src_key = (rec.get('source') if has_source else None) or 'hermes'
                    src_key = str(src_key).lower()
                    agg['perSource'][src_key] = agg['perSource'].get(src_key, 0) + 1
            elif sc:
                # No timestamp/source columns at all — still keep perSource
                # reconciled with totalSessions.
                agg['perSource']['hermes'] = agg['perSource'].get('hermes', 0) + sc
            cands = []
            for c in ('updated_at','ended_at','started_at','created_at'):
                if c in scols:
                    v = con.execute(f'select max({c}) from sessions').fetchone()[0]
                    if v is not None: cands.append(v)
            best = ''
            for c in cands:
                iso = to_iso(c)
                if iso > best: best = iso
            info['lastActiveAt'] = best
        mcols = [r[1] for r in con.execute('pragma table_info(messages)').fetchall()]
        if mcols:
            mc = int(con.execute('select count(*) from messages').fetchone()[0] or 0)
            info['messages'] = mc
            agg['totalMessages'] += mc
            # Both messages.timestamp (current Hermes) and messages.created_at
            # (older builds) store unix epoch floats. Compare numerically.
            ts_msg_col = 'timestamp' if 'timestamp' in mcols else ('created_at' if 'created_at' in mcols else None)
            if ts_msg_col:
                cnt = int(con.execute(f'select count(*) from messages where {ts_msg_col} >= ?', (cutoff,)).fetchone()[0] or 0)
                agg['activeMessages24h'] += cnt
        con.close()
    except Exception:
        pass
    agg['perProfile'].append(info)

agg['perSource'] = sorted(
    [{'source': k, 'sessions': v} for k, v in agg['perSource'].items()],
    key=lambda x: x['sessions'], reverse=True,
)
agg['lastActiveAt'] = to_iso(last_ts) if last_ts > 0 else ''
print(json.dumps(agg, ensure_ascii=False))`;
  const r = await runPython<{
    totalSessions?: number; totalMessages?: number;
    activeSessions24h?: number; activeMessages24h?: number;
    perProfile?: DeckStats['perProfile']; perSource?: DeckStats['perSource'];
    lastActiveAt?: string;
  }>(script, { timeoutMs: 12000, env: { ...process.env, PROFILE_FILTER: safeProfile } });
  if (!r.ok) throw new Error(`getDeckStats failed: ${r.error}`);
  const raw = r.value;
  return {
    scope: safeProfile || 'all',
    totalSessions: raw.totalSessions || 0,
    totalMessages: raw.totalMessages || 0,
    activeSessions24h: raw.activeSessions24h || 0,
    activeMessages24h: raw.activeMessages24h || 0,
    perProfile: raw.perProfile || [],
    perSource: raw.perSource || [],
    lastActiveAt: raw.lastActiveAt || undefined,
  };
}
