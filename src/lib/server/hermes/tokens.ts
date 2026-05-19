import type { TokenStats } from '@/lib/types';
import { runPython } from '../run-python';

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

  const r = await runPython<TokenStats>(script, { timeoutMs: 12000 });
  if (!r.ok) throw new Error(`getTokenStats failed: ${r.error}`);
  return r.value;
}
