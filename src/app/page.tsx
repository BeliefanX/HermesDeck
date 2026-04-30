'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deckApi } from '@/lib/api';
import type { DeckHealth, DeckProfile, DeckSession, ToolSummary, TokenStats } from '@/lib/types';
import { sourceMeta, shortTitle, relTime } from '@/lib/format';
import {
  Bot, Database, HeartPulse, MessageSquare, Radio, Wrench, ArrowUpRight, Activity, ChevronRight,
  Hash, Cpu, GitBranch, BarChart3, Server, Sparkles, Plug, Boxes, Terminal, Clock, Layers,
  Coins, ArrowDownRight, ArrowUpRight as ArrowUR, TrendingUp, DollarSign, Zap, CalendarDays, Flame,
} from 'lucide-react';

const HOURS = 24;

export default function HomePage() {
  const [health, setHealth] = useState<DeckHealth | null>(null);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [sessions, setSessions] = useState<DeckSession[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [tokens, setTokens] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    async function load() {
      const [h, p, s, t, k] = await Promise.allSettled([
        deckApi.health(), deckApi.profiles(), deckApi.sessions(), deckApi.tools(), deckApi.tokens(14),
      ]);
      if (!alive) return;
      if (h.status === 'fulfilled') setHealth(h.value);
      if (p.status === 'fulfilled') setProfiles(p.value.profiles);
      if (s.status === 'fulfilled') setSessions(s.value.sessions);
      if (t.status === 'fulfilled') setTools(t.value.tools);
      if (k.status === 'fulfilled') setTokens(k.value);
      setNow(Date.now());
      setLoading(false);
    }
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const statusClass = health?.status === 'connected' ? 'ok' : health?.status === 'degraded' ? 'warn' : 'bad';
  const statusLabel = health?.status === 'connected' ? 'Connected'
    : health?.status === 'degraded' ? 'Degraded'
    : health ? 'Disconnected' : 'Checking';
  const activeProfile = profiles.find((p) => p.active);

  // ── Aggregations ────────────────────────────────────────────────
  const totalMessages = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.messageCount || 0), 0),
    [sessions]
  );

  const lastDayCount = useMemo(() => {
    const cutoff = now - 24 * 3600 * 1000;
    return sessions.filter((s) => {
      const ts = Date.parse(s.updatedAt || s.createdAt || '');
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
  }, [sessions, now]);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      const k = (s.source || 'hermes').toLowerCase();
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([source, count]) => ({ source, count }));
  }, [sessions]);

  const profileBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => map.set(s.profileId || 'default', (map.get(s.profileId || 'default') || 0) + 1));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => {
        const p = profiles.find((x) => x.id === id);
        return { id, name: p?.name || id, active: !!p?.active, count };
      });
  }, [sessions, profiles]);

  const toolBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    tools.forEach((t) => map.set(t.kind, (map.get(t.kind) || 0) + 1));
    const order = ['toolset', 'skill', 'mcp', 'unknown'];
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ kind: k, count: map.get(k)! }));
  }, [tools]);

  // 24h hourly activity bins (based on session updatedAt)
  const activity = useMemo(() => {
    const buckets = Array.from({ length: HOURS }, () => 0);
    const cutoff = now - HOURS * 3600 * 1000;
    sessions.forEach((s) => {
      const ts = Date.parse(s.updatedAt || s.createdAt || '');
      if (!Number.isFinite(ts) || ts < cutoff) return;
      const idx = HOURS - 1 - Math.floor((now - ts) / (3600 * 1000));
      if (idx >= 0 && idx < HOURS) buckets[idx] += 1;
    });
    const peak = buckets.reduce((m, v) => Math.max(m, v), 0);
    return { buckets, peak };
  }, [sessions, now]);

  const peakHour = useMemo(() => {
    let max = 0;
    let idx = -1;
    activity.buckets.forEach((v, i) => { if (v > max) { max = v; idx = i; } });
    if (idx < 0) return '—';
    const d = new Date(now - (HOURS - 1 - idx) * 3600 * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  }, [activity, now]);

  const avgMsgsPerSession = sessions.length === 0 ? 0
    : Math.round((totalMessages / sessions.length) * 10) / 10;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="page grid">
      {/* Hero */}
      <section className="card hero-card">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="hero-kicker">Command deck</div>
            <h1>Hermes command deck</h1>
            <p className="muted" style={{ maxWidth: 640, marginTop: 12, fontSize: 14.5 }}>
              Multi-session chat workspace — profiles, runs, tools and a safe terminal in one place. All data comes from Hermes&rsquo; native state.db and API Server. Zero hard-coded values in the frontend.
            </p>
          </div>
          <span className={`pill ${statusClass}`} style={{ alignSelf: 'flex-start' }}>
            <Activity size={12} /> {statusLabel}
          </span>
        </div>
        <div className="row start" style={{ marginTop: 22, gap: 10, flexWrap: 'wrap' }}>
          <Link href="/chat" className="btn primary"><MessageSquare size={15} /> Open chat</Link>
          <Link href="/terminal" className="btn ghost"><Terminal size={15} /> Safe terminal</Link>
          {activeProfile && <span className="pill" style={{ marginLeft: 'auto' }}>profile · {activeProfile.name}</span>}
        </div>
      </section>

      {/* Metric grid — 6 cards in cols-3 */}
      <div className="grid cols-3">
        <Metric
          icon={<HeartPulse size={18} />}
          label="Hermes API"
          value={loading ? <Skel w={80} /> : health?.apiServer.healthy ? 'Healthy' : 'Fallback'}
          detail={health?.apiServer.baseUrl || '—'}
        />
        <Metric
          icon={<Bot size={18} />}
          label="Profiles"
          value={loading ? <Skel w={40} /> : profiles.length}
          detail={activeProfile?.name ? `active · ${activeProfile.name}` : 'default'}
        />
        <Metric
          icon={<MessageSquare size={18} />}
          label="Sessions"
          value={loading ? <Skel w={40} /> : sessions.length}
          detail={`24h · ${lastDayCount}`}
        />
        <Metric
          icon={<Hash size={18} />}
          label="Total messages"
          value={loading ? <Skel w={50} /> : totalMessages.toLocaleString()}
          detail={sessions.length ? `avg ${avgMsgsPerSession} / session` : '—'}
        />
        <Metric
          icon={<Wrench size={18} />}
          label="Tools / Skills"
          value={loading ? <Skel w={40} /> : tools.length}
          detail={toolBreakdown.map((b) => `${b.kind} ${b.count}`).join(' · ') || 'dynamic discovery'}
        />
        <Metric
          icon={<Database size={18} />}
          label="Dashboard"
          value={loading ? <Skel w={70} /> : health?.dashboard.healthy ? 'Online' : 'Sidecar'}
          detail={health?.dashboard.baseUrl || '—'}
        />
      </div>

      {/* 24h activity */}
      <section className="card">
        <div className="section-head">
          <div className="section-title">
            <span className="section-kicker">24 hour activity</span>
            <h2>Session activity</h2>
          </div>
          <span className="pill"><BarChart3 size={12} /> hourly buckets</span>
        </div>

        <div className="spark-chart" aria-label="Sessions updated in the last 24 hours">
          {activity.buckets.map((v, i) => {
            const pct = activity.peak === 0 ? 0 : (v / activity.peak) * 100;
            const isPeak = v > 0 && v === activity.peak;
            return (
              <div
                key={i}
                className={`spark-bar ${v > 0 ? 'has-data' : ''} ${isPeak ? 'peak' : ''}`}
                style={{ height: `${v > 0 ? Math.max(pct, 12) : 3}%` }}
                title={`${v} session${v === 1 ? '' : 's'} updated`}
                aria-hidden
              />
            );
          })}
        </div>
        <div className="spark-axis">
          <span>−24h</span>
          <span>−18h</span>
          <span>−12h</span>
          <span>−6h</span>
          <span>now</span>
        </div>

        <div className="spark-summary">
          <div>
            <div className="label">24H SESSIONS</div>
            <div className="value">{loading ? '—' : lastDayCount}</div>
            <div className="detail">{sessions.length ? `${Math.round((lastDayCount / sessions.length) * 100)}% of all` : 'no data yet'}</div>
          </div>
          <div>
            <div className="label">PEAK HOUR</div>
            <div className="value">{peakHour}</div>
            <div className="detail">{activity.peak ? `${activity.peak} session${activity.peak === 1 ? '' : 's'}` : '—'}</div>
          </div>
          <div>
            <div className="label">TOTAL MESSAGES</div>
            <div className="value">{loading ? '—' : totalMessages.toLocaleString()}</div>
            <div className="detail">{sessions.length ? `across ${sessions.length} session${sessions.length === 1 ? '' : 's'}` : '—'}</div>
          </div>
        </div>
      </section>

      {/* Token usage hero card + KPI strip */}
      <TokenUsageCard tokens={tokens} loading={loading} />

      {/* Token charts: daily trend + weekday/hour heatmap */}
      <div className="grid cols-2">
        <TokenDailyChart tokens={tokens} loading={loading} />
        <TokenHourlyHeatmap tokens={tokens} loading={loading} />
      </div>

      {/* Top models + sources by token spend */}
      <div className="grid cols-2">
        <TopModelsByTokens tokens={tokens} loading={loading} />
        <TopSourcesByTokens tokens={tokens} loading={loading} />
      </div>

      {/* Profiles + Recent Sessions */}
      <div className="grid cols-2">
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Execution contexts</span>
              <h2>Profiles</h2>
            </div>
            <Link href="/profiles" className="pill">{profiles.length} contexts <ChevronRight size={12} /></Link>
          </div>
          <div className="list">
            {loading && profiles.length === 0 && Array.from({ length: 3 }).map((_, i) => (
              <div className="list-row" key={i}>
                <div className="meta"><Skel w={120} /><div style={{ height: 6 }} /><Skel w={180} /></div>
              </div>
            ))}
            {profiles.map((p) => (
              <div className="list-row" key={p.id}>
                <div className="meta">
                  <b>
                    {p.name}
                    {p.active && <span className="pill ok" style={{ marginLeft: 6 }}>active</span>}
                  </b>
                  <div className="muted">
                    <Cpu size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {p.model || 'model from Hermes'}
                    <span style={{ margin: '0 6px', opacity: .5 }}>·</span>
                    <GitBranch size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {p.gateway || 'gateway n/a'}
                  </div>
                </div>
                <span className="kbd">{p.id}</span>
              </div>
            ))}
            {!loading && profiles.length === 0 && (
              <div className="empty-state" style={{ padding: 18 }}>
                <p className="muted">No profiles found — running with the default context.</p>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Recent sessions</span>
              <h2>Recent sessions</h2>
            </div>
            <Link href="/chat" className="pill"><ArrowUpRight size={12} /> Open chat</Link>
          </div>
          <div className="list">
            {loading && sessions.length === 0 && Array.from({ length: 4 }).map((_, i) => (
              <div className="list-row" key={i}>
                <div className="meta"><Skel w={180} /><div style={{ height: 6 }} /><Skel w={120} /></div>
              </div>
            ))}
            {sessions.slice(0, 6).map((s) => {
              const meta = sourceMeta(s.source);
              const time = relTime(s.updatedAt || s.createdAt);
              return (
                <div className="list-row" key={s.id}>
                  <div className="meta" style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                    <span className={`tag ${meta.tone}`} title={meta.label}>{meta.short}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <b>{shortTitle(s.title, 40)}</b>
                      <div className="muted small">
                        {s.model || '—'}{time && <> · <Clock size={11} style={{ verticalAlign: -1 }} /> {time}</>}
                      </div>
                    </div>
                  </div>
                  <span className="kbd">{s.messageCount ?? 0}</span>
                </div>
              );
            })}
            {!loading && sessions.length === 0 && (
              <div className="empty-state" style={{ padding: 18 }}>
                <p className="muted">No sessions yet. Send a message in chat to create your first one.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Source distribution + Profile workload */}
      <div className="grid cols-2">
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Source distribution</span>
              <h2>Sessions by source</h2>
            </div>
            <span className="pill">{sourceBreakdown.length} channels</span>
          </div>
          <div className="bar-list">
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div className="bar-row" key={i}>
                <Skel w={70} />
                <div className="bar-track"><div className="bar-fill muted" style={{ width: `${30 + i * 18}%` }} /></div>
                <Skel w={32} />
              </div>
            ))}
            {!loading && sourceBreakdown.length === 0 && (
              <div className="empty-state" style={{ padding: 18 }}>
                <p className="muted">No source data yet.</p>
              </div>
            )}
            {!loading && sourceBreakdown.map(({ source, count }) => {
              const meta = sourceMeta(source);
              const pct = sessions.length ? (count / sessions.length) * 100 : 0;
              return (
                <div className="bar-row" key={source}>
                  <span className="bar-label">
                    <span className={`tag ${meta.tone}`} style={{ minWidth: 'auto' }}>{meta.short}</span>
                  </span>
                  <div className="bar-track" aria-label={`${meta.label}: ${count} sessions`}>
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">{count}<span className="muted" style={{ fontSize: 10 }}>·{Math.round(pct)}%</span></span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Workload by profile</span>
              <h2>Profile workload</h2>
            </div>
            <span className="pill">{profileBreakdown.length} active</span>
          </div>
          <div className="bar-list">
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div className="bar-row" key={i}>
                <Skel w={70} />
                <div className="bar-track"><div className="bar-fill muted" style={{ width: `${50 - i * 12}%` }} /></div>
                <Skel w={32} />
              </div>
            ))}
            {!loading && profileBreakdown.length === 0 && (
              <div className="empty-state" style={{ padding: 18 }}>
                <p className="muted">No profile workload data yet.</p>
              </div>
            )}
            {!loading && profileBreakdown.map(({ id, name, active, count }) => {
              const pct = sessions.length ? (count / sessions.length) * 100 : 0;
              return (
                <div className="bar-row" key={id}>
                  <span className="bar-label">
                    <Bot size={12} color="var(--muted)" />
                    {name}
                    {active && <span className="pill ok" style={{ padding: '1px 6px', fontSize: 9 }}>active</span>}
                  </span>
                  <div className="bar-track" aria-label={`${name}: ${count} sessions`}>
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">{count}<span className="muted" style={{ fontSize: 10 }}>·{Math.round(pct)}%</span></span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Capabilities + Quick actions */}
      <div className="grid cols-2">
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Capabilities</span>
              <h2>Capabilities</h2>
            </div>
            <Link href="/tools" className="pill">{tools.length} items <ChevronRight size={12} /></Link>
          </div>
          <div className="bar-list">
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div className="bar-row" key={i}>
                <Skel w={70} />
                <div className="bar-track"><div className="bar-fill muted" style={{ width: `${60 - i * 14}%` }} /></div>
                <Skel w={32} />
              </div>
            ))}
            {!loading && toolBreakdown.length === 0 && (
              <div className="empty-state" style={{ padding: 18 }}>
                <p className="muted">CLI did not return a tools / skills list.</p>
              </div>
            )}
            {!loading && toolBreakdown.map(({ kind, count }) => {
              const pct = tools.length ? (count / tools.length) * 100 : 0;
              return (
                <div className="bar-row" key={kind}>
                  <span className="bar-label">
                    {kind === 'toolset' && <Wrench size={13} color="var(--accent)" />}
                    {kind === 'skill' && <Sparkles size={13} color="var(--accent)" />}
                    {kind === 'mcp' && <Plug size={13} color="var(--accent)" />}
                    {kind === 'unknown' && <Boxes size={13} color="var(--muted)" />}
                    {kind}
                  </span>
                  <div className="bar-track" aria-label={`${kind}: ${count} items`}>
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">{count}<span className="muted" style={{ fontSize: 10 }}>·{Math.round(pct)}%</span></span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">Quick actions</span>
              <h2>Quick actions</h2>
            </div>
            <span className="pill"><Radio size={11} /> live</span>
          </div>
          <div className="action-grid">
            <Link href="/chat" className="action-card">
              <span className="action-icon"><MessageSquare size={15} /></span>
              <span className="action-text">
                <span className="action-title">New chat</span>
                <span className="action-sub">SSE · multi-session</span>
              </span>
            </Link>
            <Link href="/profiles" className="action-card">
              <span className="action-icon"><Bot size={15} /></span>
              <span className="action-text">
                <span className="action-title">Switch profile</span>
                <span className="action-sub">{profiles.length} execution contexts</span>
              </span>
            </Link>
            <Link href="/tools" className="action-card">
              <span className="action-icon"><Wrench size={15} /></span>
              <span className="action-text">
                <span className="action-title">Capabilities</span>
                <span className="action-sub">tools · skills · MCP</span>
              </span>
            </Link>
            <Link href="/runs" className="action-card">
              <span className="action-icon"><Layers size={15} /></span>
              <span className="action-text">
                <span className="action-title">Run timeline</span>
                <span className="action-sub">SSE event stream</span>
              </span>
            </Link>
            <Link href="/terminal" className="action-card">
              <span className="action-icon"><Terminal size={15} /></span>
              <span className="action-text">
                <span className="action-title">Safe terminal</span>
                <span className="action-sub">allowlisted commands</span>
              </span>
            </Link>
            <Link href="/settings" className="action-card">
              <span className="action-icon"><Server size={15} /></span>
              <span className="action-text">
                <span className="action-title">Settings</span>
                <span className="action-sub">theme / preferences</span>
              </span>
            </Link>
          </div>
        </section>
      </div>

      {/* System info */}
      <section className="card">
        <div className="section-head">
          <div className="section-title">
            <span className="section-kicker">Runtime metadata</span>
            <h2>System info</h2>
          </div>
          <span className="pill"><Server size={12} /> Hermes BFF</span>
        </div>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-key">Hermes Version</span>
            <span className="kv-val">{loading ? '—' : (health?.version || 'unknown')}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">API Server</span>
            <span className="kv-val">
              {health?.apiServer.baseUrl || '—'}
              {health?.apiServer.detail && (
                <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>· {health.apiServer.detail.slice(0, 60)}</span>
              )}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Dashboard</span>
            <span className="kv-val">
              {health?.dashboard.baseUrl || '—'}
              {health?.dashboard.detail && (
                <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>· {health.dashboard.detail}</span>
              )}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Deck Uptime</span>
            <span className="kv-val">{health?.uptimeSeconds != null ? formatUptime(health.uptimeSeconds) : '—'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Streaming</span>
            <span className="kv-val text">SSE · response.delta · run-event · done</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">State</span>
            <span className="kv-val text">~/.hermes/state.db · ~/.hermes/profiles/&lt;id&gt;/state.db</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ icon, label, value, detail }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; detail: string;
}) {
  return (
    <div className="card metric-card hover-lift">
      <div className="metric-top">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
      </div>
      <div>
        <div className="metric">{value}</div>
        <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
      </div>
    </div>
  );
}

function Skel({ w = 80 }: { w?: number }) {
  return <span className="skel" style={{ display: 'inline-block', width: w, height: 18, verticalAlign: 'middle' }} />;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function TokenUsageCard({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const t = tokens?.totals;
  const day = tokens?.last24h;
  const totalDailyTokens = (tokens?.daily || []).reduce((s, d) => s + d.total, 0);
  const sparkPeak = (tokens?.daily || []).reduce((m, d) => Math.max(m, d.total), 0);
  const cacheRatio = t && t.input > 0 ? Math.round((t.cacheRead / Math.max(t.input, 1)) * 100) : 0;
  return (
    <section className="card token-hero">
      <div className="token-hero-grid">
        <div className="token-hero-left">
          <div className="hero-kicker">Token usage</div>
          <h2 className="token-hero-total">
            {loading || !t ? '—' : fmtTokens(t.total)}
            <span className="token-hero-unit">tokens</span>
          </h2>
          <div className="token-hero-meta">
            <span className="token-meta-pill"><DollarSign size={11} /> total cost <b>{loading || !t ? '—' : fmtCost(t.cost)}</b></span>
            <span className="token-meta-pill"><Activity size={11} /> {loading || !t ? '—' : t.sessions.toLocaleString()} sessions</span>
            <span className="token-meta-pill"><Zap size={11} /> {loading || !t ? '—' : t.apiCalls.toLocaleString()} API calls</span>
          </div>

          <div className="token-split">
            <div className="token-split-row">
              <span className="token-split-label"><ArrowDownRight size={12} /> Input</span>
              <div className="token-split-bar"><div className="fill is-input" style={{ width: t && t.total ? `${(t.input / t.total) * 100}%` : '0%' }} /></div>
              <span className="token-split-val">{loading || !t ? '—' : fmtTokens(t.input)}</span>
            </div>
            <div className="token-split-row">
              <span className="token-split-label"><ArrowUR size={12} /> Output</span>
              <div className="token-split-bar"><div className="fill is-output" style={{ width: t && t.total ? `${(t.output / t.total) * 100}%` : '0%' }} /></div>
              <span className="token-split-val">{loading || !t ? '—' : fmtTokens(t.output)}</span>
            </div>
            {t && t.cacheRead > 0 && (
              <div className="token-split-row">
                <span className="token-split-label"><Database size={12} /> Cache read</span>
                <div className="token-split-bar"><div className="fill is-cache" style={{ width: t && t.total ? `${(t.cacheRead / t.total) * 100}%` : '0%' }} /></div>
                <span className="token-split-val">{fmtTokens(t.cacheRead)} <span className="muted small" style={{ marginLeft: 4 }}>{cacheRatio}%</span></span>
              </div>
            )}
            {t && t.reasoning > 0 && (
              <div className="token-split-row">
                <span className="token-split-label"><Sparkles size={12} /> Reasoning</span>
                <div className="token-split-bar"><div className="fill is-reasoning" style={{ width: t && t.total ? `${(t.reasoning / t.total) * 100}%` : '0%' }} /></div>
                <span className="token-split-val">{fmtTokens(t.reasoning)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="token-hero-right">
          <div className="token-kpi-row">
            <div className="token-kpi">
              <div className="token-kpi-label">Last 24h</div>
              <div className="token-kpi-value">{loading || !day ? '—' : fmtTokens(day.total)}</div>
              <div className="token-kpi-detail">{loading || !day ? '—' : `${day.sessions} sessions`}</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-label">14d total</div>
              <div className="token-kpi-value">{loading || !tokens ? '—' : fmtTokens(totalDailyTokens)}</div>
              <div className="token-kpi-detail">rolling window</div>
            </div>
          </div>
          <div className="token-spark" aria-label="14-day token usage trend">
            {(tokens?.daily || []).map((d) => {
              const pct = sparkPeak ? (d.total / sparkPeak) * 100 : 0;
              return (
                <div
                  key={d.date}
                  className={`token-spark-bar ${d.total > 0 ? 'has-data' : ''} ${d.total === sparkPeak && d.total > 0 ? 'peak' : ''}`}
                  style={{ height: `${d.total > 0 ? Math.max(pct, 14) : 3}%` }}
                  title={`${d.date} · ${fmtTokens(d.total)} tokens · ${fmtCost(d.cost)}`}
                />
              );
            })}
          </div>
          <div className="token-spark-axis">
            <span>−14d</span><span>−7d</span><span>now</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TokenDailyChart({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const daily = tokens?.daily || [];
  const peak = daily.reduce((m, d) => Math.max(m, d.input + d.output), 0);
  const totalCost = daily.reduce((s, d) => s + d.cost, 0);
  return (
    <section className="card">
      <div className="section-head">
        <div className="section-title">
          <span className="section-kicker">Token trend</span>
          <h2>Daily token usage</h2>
        </div>
        <span className="pill"><TrendingUp size={12} /> {tokens?.windowDays || 14}d window</span>
      </div>
      <div className="stacked-chart" aria-label="Daily input/output token stack">
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div className="stacked-bar-wrap" key={i}><div className="stacked-bar skel-bar" style={{ height: `${20 + (i * 7) % 60}%` }} /></div>
        ))}
        {!loading && daily.map((d) => {
          const total = d.input + d.output;
          const heightPct = peak ? (total / peak) * 100 : 0;
          const inputPct = total ? (d.input / total) * 100 : 0;
          return (
            <div className="stacked-bar-wrap" key={d.date} title={`${d.date}\nInput ${fmtTokens(d.input)}  Output ${fmtTokens(d.output)}\n${fmtCost(d.cost)}`}>
              <div className="stacked-bar" style={{ height: `${total > 0 ? Math.max(heightPct, 14) : 3}%` }}>
                <div className="seg is-input" style={{ height: `${inputPct}%` }} />
                <div className="seg is-output" style={{ height: `${100 - inputPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="chart-legend">
        <span className="legend-dot is-input" /> Input
        <span className="legend-dot is-output" /> Output
        <span style={{ marginLeft: 'auto' }} className="muted small">Window cost {loading ? '—' : fmtCost(totalCost)}</span>
      </div>
    </section>
  );
}

function TokenHourlyHeatmap({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const hourly = tokens?.hourly || Array(24).fill(0);
  const weekday = tokens?.weekday || Array(7).fill(0);
  const peakHour = hourly.reduce((m, v) => Math.max(m, v), 0);
  const peakDay = weekday.reduce((m, v) => Math.max(m, v), 0);
  const peakHourIdx = hourly.indexOf(peakHour);
  const peakDayIdx = weekday.indexOf(peakDay);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <section className="card">
      <div className="section-head">
        <div className="section-title">
          <span className="section-kicker">Activity rhythm</span>
          <h2>Activity rhythm</h2>
        </div>
        <span className="pill"><CalendarDays size={12} /> hour × weekday</span>
      </div>

      <div className="rhythm-block">
        <div className="rhythm-label">Tokens by weekday</div>
        <div className="weekday-row">
          {weekday.map((v, i) => {
            const intensity = peakDay ? v / peakDay : 0;
            return (
              <div className="weekday-cell" key={i} title={`${dayNames[i]} · ${fmtTokens(v)}`}>
                <div className="weekday-bar"><div className="weekday-fill" style={{ opacity: 0.12 + intensity * 0.88 }} /></div>
                <div className="weekday-name">{dayNames[i]}</div>
              </div>
            );
          })}
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {loading ? '—' : peakDay > 0 ? <>Peak <b>{dayNames[peakDayIdx]}</b> · {fmtTokens(peakDay)} tokens</> : 'No data yet'}
        </div>
      </div>

      <div className="rhythm-block">
        <div className="rhythm-label">Hour-of-day (0–23)</div>
        <div className="hourly-row" aria-label="Hourly token usage">
          {hourly.map((v, i) => {
            const pct = peakHour ? (v / peakHour) * 100 : 0;
            return (
              <div
                key={i}
                className={`hour-bar ${v > 0 ? 'has-data' : ''} ${v === peakHour && v > 0 ? 'peak' : ''}`}
                style={{ height: `${v > 0 ? Math.max(pct, 12) : 3}%` }}
                title={`${i.toString().padStart(2, '0')}:00 · ${fmtTokens(v)}`}
              />
            );
          })}
        </div>
        <div className="hourly-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {loading ? '—' : peakHour > 0 ? <>Peak <b>{peakHourIdx.toString().padStart(2, '0')}:00</b> · {fmtTokens(peakHour)} tokens</> : 'No data yet'}
        </div>
      </div>
    </section>
  );
}

function TopModelsByTokens({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const models = tokens?.topModels || [];
  const peak = models.reduce((m, x) => Math.max(m, x.tokens), 0);
  return (
    <section className="card">
      <div className="section-head">
        <div className="section-title">
          <span className="section-kicker">By model</span>
          <h2>Top Models · 14d</h2>
        </div>
        <Link href="/models" className="pill">View all <ChevronRight size={12} /></Link>
      </div>
      <div className="bar-list">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div className="bar-row" key={i}>
            <Skel w={80} />
            <div className="bar-track"><div className="bar-fill muted" style={{ width: `${60 - i * 12}%` }} /></div>
            <Skel w={36} />
          </div>
        ))}
        {!loading && models.length === 0 && (
          <div className="empty-state" style={{ padding: 18 }}>
            <p className="muted">No token usage in this window yet.</p>
          </div>
        )}
        {!loading && models.map((m) => {
          const pct = peak ? (m.tokens / peak) * 100 : 0;
          return (
            <div className="bar-row" key={m.model}>
              <span className="bar-label" title={m.model}>
                <Cpu size={12} color="var(--accent)" /> <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</span>
              </span>
              <div className="bar-track" aria-label={`${m.model} ${fmtTokens(m.tokens)} tokens`}>
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="bar-value">
                {fmtTokens(m.tokens)}
                <span className="muted" style={{ fontSize: 10 }}>{fmtCost(m.cost)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopSourcesByTokens({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const sources = tokens?.topSources || [];
  const peak = sources.reduce((m, x) => Math.max(m, x.tokens), 0);
  return (
    <section className="card">
      <div className="section-head">
        <div className="section-title">
          <span className="section-kicker">By source</span>
          <h2>Top sources · 14d</h2>
        </div>
        <span className="pill"><Flame size={12} /> by tokens</span>
      </div>
      <div className="bar-list">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div className="bar-row" key={i}>
            <Skel w={80} />
            <div className="bar-track"><div className="bar-fill muted" style={{ width: `${60 - i * 12}%` }} /></div>
            <Skel w={36} />
          </div>
        ))}
        {!loading && sources.length === 0 && (
          <div className="empty-state" style={{ padding: 18 }}>
            <p className="muted">No source data in this window yet.</p>
          </div>
        )}
        {!loading && sources.map((s) => {
          const pct = peak ? (s.tokens / peak) * 100 : 0;
          const meta = sourceMeta(s.source);
          return (
            <div className="bar-row" key={s.source}>
              <span className="bar-label" title={meta.label}>
                <span className={`tag ${meta.tone}`} style={{ minWidth: 'auto' }}>{meta.short}</span>
              </span>
              <div className="bar-track" aria-label={`${meta.label} ${fmtTokens(s.tokens)} tokens`}>
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="bar-value">
                {fmtTokens(s.tokens)}
                <span className="muted" style={{ fontSize: 10 }}>{s.sessions} sessions</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
