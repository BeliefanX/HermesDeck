'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deckApi } from '@/lib/api';
import type { DeckHealth, DeckProfile, DeckSession, ToolSummary, TokenStats } from '@/lib/types';
import { sourceMeta, shortTitle, relTime } from '@/lib/format';
import {
  MessageSquare, Terminal, Bot, ChevronRight, Activity, Wrench, Sparkles, Plug, Boxes,
  HeartPulse, Database, Hash, Cpu, BarChart3, Server, Layers, Radio,
  ArrowDownRight, ArrowUpRight, DollarSign, Zap, TrendingUp, CalendarDays, Flame, Clock,
  GitBranch,
} from 'lucide-react';
import {
  Page, Card, Kicker, Tag, MetricCard, BarRow, Sparkline, Btn, SectionHead, Kbd, type Tone,
} from '@/components/Brand';

const HOURS = 24;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

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

  const statusTone: Tone = health?.status === 'connected' ? 'green' : health?.status === 'degraded' ? 'yellow' : 'red';
  const statusLabel = health?.status === 'connected' ? 'Connected'
    : health?.status === 'degraded' ? 'Degraded'
    : health ? 'Disconnected' : 'Checking';
  const activeProfile = profiles.find((p) => p.active);

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
    return order.filter((k) => map.has(k)).map((k) => ({ kind: k, count: map.get(k)! }));
  }, [tools]);

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

  return (
    <Page>
      {/* Hero */}
      <Card hero padding={22}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Kicker style={{ marginBottom: 8 }}>COMMAND DECK</Kicker>
            <h1 style={{ fontSize: 'clamp(24px, 2.8vw, 30px)', lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.035em', color: 'var(--strong-text)', margin: '0 0 8px' }}>
              Hermes control deck
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              Multi-session chat workbench. Profiles, Runs, Tools and the safe terminal in one console. All data sourced
              from Hermes-native <Kbd>state.db</Kbd> and API Server — zero hard-coding in the frontend.
            </p>
          </div>
          <Tag variant={statusTone} icon={<Activity size={11} />}>{statusLabel}</Tag>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" style={{ textDecoration: 'none' }}>
            <Btn variant="primary" icon={<MessageSquare size={14} />}>Open chat</Btn>
          </Link>
          <Link href="/terminal" style={{ textDecoration: 'none' }}>
            <Btn icon={<Terminal size={14} />}>Open terminal</Btn>
          </Link>
          {activeProfile && (
            <Tag style={{ marginLeft: 'auto' }} icon={<Bot size={11} />}>profile · {activeProfile.name}</Tag>
          )}
        </div>
      </Card>

      {/* 6 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker="HERMES API"
          value={loading ? '—' : health?.apiServer.healthy ? 'Healthy' : 'Fallback'}
          sub={health?.apiServer.baseUrl || '—'}
        />
        <MetricCard
          kicker="PROFILES"
          value={loading ? '—' : profiles.length}
          sub={activeProfile?.name ? `active · ${activeProfile.name}` : 'default'}
        />
        <MetricCard
          kicker="SESSIONS"
          value={loading ? '—' : sessions.length}
          sub={`24h · ${lastDayCount}`}
        />
        <MetricCard
          kicker="TOTAL MESSAGES"
          value={loading ? '—' : totalMessages.toLocaleString()}
          sub={sessions.length ? `avg ${avgMsgsPerSession} / session` : '—'}
        />
        <MetricCard
          kicker="TOOLS / SKILLS"
          value={loading ? '—' : tools.length}
          sub={toolBreakdown.map((b) => `${b.kind} ${b.count}`).join(' · ') || 'dynamic discovery'}
        />
        <MetricCard
          kicker="DASHBOARD"
          value={loading ? '—' : health?.dashboard.healthy ? 'Online' : 'Sidecar'}
          sub={health?.dashboard.baseUrl || '—'}
        />
      </div>

      {/* 24h activity */}
      <Card>
        <SectionHead
          kicker="24 HOUR ACTIVITY"
          title="Session heatmap"
          right={<Tag icon={<BarChart3 size={11} />}>hourly buckets</Tag>}
        />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96, paddingTop: 4 }} aria-label="Last 24h activity">
          {activity.buckets.map((v, i) => {
            const pctVal = activity.peak === 0 ? 0 : (v / activity.peak) * 100;
            const isPeak = v > 0 && v === activity.peak;
            return (
              <div
                key={i}
                title={`${v} session updates`}
                style={{
                  flex: 1,
                  height: `${v > 0 ? Math.max(pctVal, 12) : 3}%`,
                  background: isPeak ? 'var(--accent)' : v > 0 ? 'rgba(56,189,248,.55)' : 'var(--surface-bg)',
                  borderRadius: 2,
                  transition: 'height 200ms cubic-bezier(.2,.7,.2,1)',
                }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted-2)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          <span>−24h</span><span>−18h</span><span>−12h</span><span>−6h</span><span>now</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          <SparkStat
            label="24H SESSIONS"
            value={loading ? '—' : lastDayCount}
            detail={sessions.length ? `${pct(lastDayCount, sessions.length)}% of total` : 'no data'}
          />
          <SparkStat
            label="PEAK HOUR"
            value={peakHour}
            detail={activity.peak ? `${activity.peak} sessions` : '—'}
          />
          <SparkStat
            label="TOTAL MESSAGES"
            value={loading ? '—' : totalMessages.toLocaleString()}
            detail={sessions.length ? `across ${sessions.length} sessions` : '—'}
          />
        </div>
      </Card>

      {/* Token usage hero */}
      <TokenUsageCard tokens={tokens} loading={loading} />

      {/* Token charts: daily stacked + weekday/hour heatmap */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <TokenDailyChart tokens={tokens} loading={loading} />
        <TokenHourlyHeatmap tokens={tokens} loading={loading} />
      </div>

      {/* Top models + Top sources by tokens */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <TopModelsByTokens tokens={tokens} loading={loading} />
        <TopSourcesByTokens tokens={tokens} loading={loading} />
      </div>

      {/* Profiles + Recent sessions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker="EXECUTION CONTEXTS"
            title="Profiles"
            right={
              <Link href="/profiles" style={{ textDecoration: 'none' }}>
                <Tag>{profiles.length} contexts</Tag>
              </Link>
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {loading && profiles.length === 0 && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
                <div className="skel" style={{ width: 140, height: 14 }} />
                <div style={{ height: 6 }} />
                <div className="skel" style={{ width: 200, height: 12 }} />
              </div>
            ))}
            {profiles.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>{p.name}</span>
                    {p.active && <Tag variant="green">active</Tag>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Cpu size={11} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.model || 'model from Hermes'}
                    </span>
                    <span style={{ opacity: .5 }}>·</span>
                    <GitBranch size={11} />
                    <span>{p.gateway || 'gateway n/a'}</span>
                  </div>
                </div>
                <Kbd>{p.id}</Kbd>
              </div>
            ))}
            {!loading && profiles.length === 0 && (
              <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                No profile found — running in default context.
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionHead
            kicker="RECENT SESSIONS"
            title="Recent sessions"
            right={
              <Link href="/chat" style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Open chat <ChevronRight size={12} />
              </Link>
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {loading && sessions.length === 0 && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
                <div className="skel" style={{ width: '60%', height: 14 }} />
                <div style={{ height: 6 }} />
                <div className="skel" style={{ width: 120, height: 12 }} />
              </div>
            ))}
            {sessions.slice(0, 6).map((s, i) => {
              const meta = sourceMeta(s.source);
              const time = relTime(s.updatedAt || s.createdAt);
              return (
                <Link
                  key={s.id}
                  href={`/chat?session=${encodeURIComponent(s.id)}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <Tag variant={tagToneForSource(meta.tone)}>{meta.short}</Tag>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {shortTitle(s.title, 40)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {s.model || '—'}{time && <> · <Clock size={10} style={{ verticalAlign: -1 }} /> {time}</>}
                      </div>
                    </div>
                  </div>
                  <Kbd>{s.messageCount ?? 0}</Kbd>
                </Link>
              );
            })}
            {!loading && sessions.length === 0 && (
              <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                No sessions yet. Send a message in chat to create your first one.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Source distribution + Profile workload */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker="SOURCE DISTRIBUTION"
            title="Sessions by source"
            right={<Tag>{sourceBreakdown.length} channels</Tag>}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center' }}>
                <div className="skel" style={{ width: 60, height: 12 }} />
                <div className="skel" style={{ width: '100%', height: 6 }} />
                <div className="skel" style={{ width: 32, height: 12 }} />
              </div>
            ))}
            {!loading && sourceBreakdown.length === 0 && (
              <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>No source data yet.</div>
            )}
            {!loading && sourceBreakdown.map(({ source, count }) => {
              const meta = sourceMeta(source);
              return (
                <BarRow
                  key={source}
                  label={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Tag variant={tagToneForSource(meta.tone)}>{meta.short}</Tag>
                    </span>
                  }
                  value={count}
                  max={sessions.length || 1}
                  raw={`${count} · ${pct(count, sessions.length)}%`}
                />
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionHead
            kicker="WORKLOAD BY PROFILE"
            title="Profile workload"
            right={<Tag>{profileBreakdown.length} active</Tag>}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center' }}>
                <div className="skel" style={{ width: 60, height: 12 }} />
                <div className="skel" style={{ width: '100%', height: 6 }} />
                <div className="skel" style={{ width: 32, height: 12 }} />
              </div>
            ))}
            {!loading && profileBreakdown.length === 0 && (
              <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>No profile workload data yet.</div>
            )}
            {!loading && profileBreakdown.map(({ id, name, active, count }) => (
              <BarRow
                key={id}
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Bot size={11} style={{ color: active ? 'var(--accent)' : 'var(--muted)' }} />
                    <span style={{ fontSize: 11.5 }}>{name}</span>
                    {active && <Tag variant="green" style={{ padding: '0 5px', fontSize: 9 }}>active</Tag>}
                  </span>
                }
                value={count}
                max={sessions.length || 1}
                raw={`${count} · ${pct(count, sessions.length)}%`}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Capabilities + Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker="CAPABILITIES"
            title="Tool categories"
            right={
              <Link href="/tools" style={{ textDecoration: 'none' }}>
                <Tag>{tools.length} items</Tag>
              </Link>
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center' }}>
                <div className="skel" style={{ width: 60, height: 12 }} />
                <div className="skel" style={{ width: '100%', height: 6 }} />
                <div className="skel" style={{ width: 32, height: 12 }} />
              </div>
            ))}
            {!loading && toolBreakdown.length === 0 && (
              <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>
                CLI returned no tools / skills list.
              </div>
            )}
            {!loading && toolBreakdown.map(({ kind, count }) => (
              <BarRow
                key={kind}
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {kind === 'toolset' && <Wrench size={12} style={{ color: 'var(--accent)' }} />}
                    {kind === 'skill' && <Sparkles size={12} style={{ color: 'var(--accent)' }} />}
                    {kind === 'mcp' && <Plug size={12} style={{ color: 'var(--accent)' }} />}
                    {kind === 'unknown' && <Boxes size={12} style={{ color: 'var(--muted)' }} />}
                    <span style={{ fontSize: 11.5 }}>{kind}</span>
                  </span>
                }
                value={count}
                max={tools.length || 1}
                raw={`${count} · ${pct(count, tools.length)}%`}
              />
            ))}
          </div>
        </Card>

        <Card>
          <SectionHead
            kicker="QUICK ACTIONS"
            title="Shortcuts"
            right={<Tag variant="green" icon={<Radio size={11} />}>live</Tag>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <ActionTile href="/chat" icon={<MessageSquare size={14} />} title="New chat" sub="SSE · multi-session" />
            <ActionTile href="/profiles" icon={<Bot size={14} />} title="Switch profile" sub={`${profiles.length} contexts`} />
            <ActionTile href="/tools" icon={<Wrench size={14} />} title="Capabilities" sub="tools · skills · MCP" />
            <ActionTile href="/runs" icon={<Layers size={14} />} title="Run timeline" sub="SSE event stream" />
            <ActionTile href="/terminal" icon={<Terminal size={14} />} title="Safe terminal" sub="allow-listed cmds" />
            <ActionTile href="/settings" icon={<Server size={14} />} title="Settings" sub="theme · prefs" />
          </div>
        </Card>
      </div>

      {/* System info */}
      <Card>
        <SectionHead
          kicker="RUNTIME METADATA"
          title="System info"
          right={<Tag icon={<Server size={11} />}>Hermes BFF</Tag>}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <KvRow first label="Hermes Version" value={loading ? '—' : (health?.version || 'unknown')} />
          <KvRow
            label="API Server"
            value={
              <>
                {health?.apiServer.baseUrl || '—'}
                {health?.apiServer.detail && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>· {health.apiServer.detail.slice(0, 60)}</span>
                )}
              </>
            }
          />
          <KvRow
            label="Dashboard"
            value={
              <>
                {health?.dashboard.baseUrl || '—'}
                {health?.dashboard.detail && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>· {health.dashboard.detail}</span>
                )}
              </>
            }
          />
          <KvRow label="Deck Uptime" value={health?.uptimeSeconds != null ? formatUptime(health.uptimeSeconds) : '—'} />
          <KvRow label="Streaming" value={<>SSE · response.delta · run-event · done</>} />
          <KvRow label="State" value={<>~/.hermes/state.db · ~/.hermes/profiles/&lt;id&gt;/state.db</>} />
        </div>
      </Card>
    </Page>
  );
}

// ───────────────────────── Sub-components ─────────────────────────

function tagToneForSource(tone: string): Tone {
  if (tone === 'accent') return 'accent';
  if (tone === 'green') return 'green';
  if (tone === 'yellow') return 'yellow';
  if (tone === 'red') return 'red';
  if (tone === 'cyan') return 'cyan';
  return 'default';
}

function SparkStat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div>
      <Kicker>{label}</Kicker>
      <div style={{ fontSize: 18, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {value}
      </div>
      {detail ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{detail}</div> : null}
    </div>
  );
}

function ActionTile({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: 8,
        background: 'var(--surface-bg)',
        border: '1px solid var(--line)',
        textDecoration: 'none',
        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--strong-text)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
    </Link>
  );
}

function KvRow({ label, value, first }: { label: string; value: React.ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 12,
        padding: '10px 0',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--text)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

// ───────────────────────── Token usage hero ─────────────────────────

function TokenUsageCard({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const t = tokens?.totals;
  const day = tokens?.last24h;
  const totalDailyTokens = (tokens?.daily || []).reduce((s, d) => s + d.total, 0);
  const sparkPeak = (tokens?.daily || []).reduce((m, d) => Math.max(m, d.total), 0);
  const cacheRatio = t && t.input > 0 ? Math.round((t.cacheRead / Math.max(t.input, 1)) * 100) : 0;

  return (
    <Card hero>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        {/* Left: total + splits */}
        <div>
          <Kicker>TOKEN USAGE · ALL TIME</Kicker>
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.05,
              fontWeight: 680,
              letterSpacing: '-.04em',
              color: 'var(--strong-text)',
              fontVariantNumeric: 'tabular-nums',
              margin: '6px 0 12px',
            }}
          >
            {loading || !t ? '—' : fmtTokens(t.total)}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>tokens</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <Tag icon={<DollarSign size={11} />}>cost <b style={{ marginLeft: 4 }}>{loading || !t ? '—' : fmtCost(t.cost)}</b></Tag>
            <Tag icon={<Activity size={11} />}>{loading || !t ? '—' : t.sessions.toLocaleString()} sessions</Tag>
            <Tag icon={<Zap size={11} />}>{loading || !t ? '—' : t.apiCalls.toLocaleString()} api calls</Tag>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SplitBar label="Input" icon={<ArrowDownRight size={12} />} value={t?.input || 0} total={t?.total || 0} fill="var(--accent)" />
            <SplitBar label="Output" icon={<ArrowUpRight size={12} />} value={t?.output || 0} total={t?.total || 0} fill="var(--green)" />
            {t && t.cacheRead > 0 && (
              <SplitBar
                label="Cache read"
                icon={<Database size={12} />}
                value={t.cacheRead}
                total={t.total}
                fill="var(--cyan)"
                rightExtra={<span style={{ marginLeft: 4, color: 'var(--muted-2)', fontSize: 10 }}>{cacheRatio}%</span>}
              />
            )}
            {t && t.reasoning > 0 && (
              <SplitBar label="Reasoning" icon={<Sparkles size={12} />} value={t.reasoning} total={t.total} fill="var(--yellow)" />
            )}
          </div>
        </div>

        {/* Right: 24h KPI + 14d sparkline */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Card padding={12}>
              <Kicker>LAST 24H</Kicker>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {loading || !day ? '—' : fmtTokens(day.total)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{loading || !day ? '—' : `${day.sessions} sessions`}</div>
            </Card>
            <Card padding={12}>
              <Kicker>14D TOTAL</Kicker>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {loading || !tokens ? '—' : fmtTokens(totalDailyTokens)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>rolling window</div>
            </Card>
          </div>
          <Kicker style={{ marginBottom: 6 }}>14D TOKEN TREND</Kicker>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }} aria-label="14-day token usage">
            {(tokens?.daily || []).map((d) => {
              const pctVal = sparkPeak ? (d.total / sparkPeak) * 100 : 0;
              const isPeak = d.total === sparkPeak && d.total > 0;
              return (
                <div
                  key={d.date}
                  title={`${d.date} · ${fmtTokens(d.total)} · ${fmtCost(d.cost)}`}
                  style={{
                    flex: 1,
                    height: `${d.total > 0 ? Math.max(pctVal, 14) : 3}%`,
                    background: isPeak ? 'var(--accent)' : d.total > 0 ? 'rgba(56,189,248,.65)' : 'var(--surface-bg)',
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted-2)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            <span>−14d</span><span>−7d</span><span>now</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SplitBar({
  label, icon, value, total, fill, rightExtra,
}: {
  label: string; icon: React.ReactNode; value: number; total: number; fill: string; rightExtra?: React.ReactNode;
}) {
  const pctVal = total ? (value / total) * 100 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px', gap: 12, alignItems: 'center' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text)' }}>
        {icon}{label}
      </span>
      <div style={{ height: 8, background: 'var(--surface-bg)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pctVal}%`, background: fill, borderRadius: 4 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--value-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {fmtTokens(value)}{rightExtra}
      </span>
    </div>
  );
}

// ───────────────────────── Token daily stacked chart ─────────────────────────

function TokenDailyChart({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const daily = tokens?.daily || [];
  const peak = daily.reduce((m, d) => Math.max(m, d.input + d.output), 0);
  const totalCost = daily.reduce((s, d) => s + d.cost, 0);

  return (
    <Card>
      <SectionHead
        kicker="TOKEN TREND"
        title="Daily input / output"
        right={<Tag icon={<TrendingUp size={11} />}>{tokens?.windowDays || 14}d window</Tag>}
      />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, paddingTop: 4 }} aria-label="Daily input/output stacked chart">
        {loading && Array.from({ length: 14 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: `${20 + (i * 7) % 60}%`, background: 'var(--surface-bg)', borderRadius: 2 }} />
        ))}
        {!loading && daily.map((d) => {
          const total = d.input + d.output;
          const heightPct = peak ? (total / peak) * 100 : 0;
          const inputPct = total ? (d.input / total) * 100 : 0;
          return (
            <div
              key={d.date}
              title={`${d.date}\nInput ${fmtTokens(d.input)}  Output ${fmtTokens(d.output)}\n${fmtCost(d.cost)}`}
              style={{
                flex: 1,
                height: `${total > 0 ? Math.max(heightPct, 14) : 3}%`,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 2,
                overflow: 'hidden',
                background: total > 0 ? undefined : 'var(--surface-bg)',
              }}
            >
              <div style={{ height: `${inputPct}%`, background: 'rgba(56,189,248,.65)' }} />
              <div style={{ height: `${100 - inputPct}%`, background: 'var(--green)' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)', fontSize: 11, color: 'var(--muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(56,189,248,.65)' }} /> Input
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green)' }} /> Output
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
          window cost {loading ? '—' : fmtCost(totalCost)}
        </span>
      </div>
    </Card>
  );
}

// ───────────────────────── Token hourly heatmap ─────────────────────────

function TokenHourlyHeatmap({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const hourly = tokens?.hourly || Array(24).fill(0);
  const weekday = tokens?.weekday || Array(7).fill(0);
  const peakHour = hourly.reduce((m, v) => Math.max(m, v), 0);
  const peakDay = weekday.reduce((m, v) => Math.max(m, v), 0);
  const peakHourIdx = hourly.indexOf(peakHour);
  const peakDayIdx = weekday.indexOf(peakDay);

  return (
    <Card>
      <SectionHead
        kicker="ACTIVITY RHYTHM"
        title="Usage cadence"
        right={<Tag icon={<CalendarDays size={11} />}>by hour / weekday</Tag>}
      />
      <div style={{ marginBottom: 16 }}>
        <Kicker style={{ marginBottom: 6 }}>WEEKDAY DISTRIBUTION</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, alignItems: 'flex-end', height: 60 }}>
          {weekday.map((v, i) => {
            const intensity = peakDay ? v / peakDay : 0;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }} title={`${DAY_NAMES[i]} · ${fmtTokens(v)}`}>
                <div style={{ width: '100%', height: 36, background: 'var(--surface-bg)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--accent)', opacity: 0.12 + intensity * 0.78, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{DAY_NAMES[i]}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {loading ? '—' : peakDay > 0 ? <>peak <b>{DAY_NAMES[peakDayIdx]}</b> · {fmtTokens(peakDay)} tokens</> : 'no data'}
        </div>
      </div>

      <div>
        <Kicker style={{ marginBottom: 6 }}>HOURLY (0–23)</Kicker>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }} aria-label="Hourly token usage">
          {hourly.map((v, i) => {
            const pctVal = peakHour ? (v / peakHour) * 100 : 0;
            const isPeak = v === peakHour && v > 0;
            return (
              <div
                key={i}
                title={`${i.toString().padStart(2, '0')}:00 · ${fmtTokens(v)}`}
                style={{
                  flex: 1,
                  height: `${v > 0 ? Math.max(pctVal, 12) : 3}%`,
                  background: isPeak ? 'var(--accent)' : v > 0 ? 'rgba(56,189,248,.55)' : 'var(--surface-bg)',
                  borderRadius: 2,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted-2)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          {loading ? '—' : peakHour > 0 ? <>peak <b>{peakHourIdx.toString().padStart(2, '0')}:00</b> · {fmtTokens(peakHour)} tokens</> : 'no data'}
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────── Top models / sources by tokens ─────────────────────────

function TopModelsByTokens({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const models = tokens?.topModels || [];
  const peak = models.reduce((m, x) => Math.max(m, x.tokens), 0);

  return (
    <Card>
      <SectionHead
        kicker="BY MODEL"
        title="Top models · 14d"
        right={
          <Link href="/models" style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            View all <ChevronRight size={12} />
          </Link>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px', gap: 12, alignItems: 'center' }}>
            <div className="skel" style={{ width: 80, height: 12 }} />
            <div className="skel" style={{ width: '100%', height: 6 }} />
            <div className="skel" style={{ width: 36, height: 12 }} />
          </div>
        ))}
        {!loading && models.length === 0 && (
          <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>No token usage in window.</div>
        )}
        {!loading && models.map((m) => (
          <BarRow
            key={m.model}
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }} title={m.model}>
                <Cpu size={11} style={{ color: 'var(--accent)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.model}
                </span>
              </span>
            }
            value={m.tokens}
            max={peak || 1}
            raw={
              <span>
                {fmtTokens(m.tokens)}
                <span style={{ display: 'block', fontSize: 10, color: 'var(--muted-2)' }}>{fmtCost(m.cost)}</span>
              </span>
            }
          />
        ))}
      </div>
    </Card>
  );
}

function TopSourcesByTokens({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const sources = tokens?.topSources || [];
  const peak = sources.reduce((m, x) => Math.max(m, x.tokens), 0);

  return (
    <Card>
      <SectionHead
        kicker="BY SOURCE"
        title="Top sources · 14d"
        right={<Tag icon={<Flame size={11} />}>token view</Tag>}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px', gap: 12, alignItems: 'center' }}>
            <div className="skel" style={{ width: 80, height: 12 }} />
            <div className="skel" style={{ width: '100%', height: 6 }} />
            <div className="skel" style={{ width: 36, height: 12 }} />
          </div>
        ))}
        {!loading && sources.length === 0 && (
          <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>No source records in window.</div>
        )}
        {!loading && sources.map((s) => {
          const meta = sourceMeta(s.source);
          return (
            <BarRow
              key={s.source}
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={meta.label}>
                  <Tag variant={tagToneForSource(meta.tone)}>{meta.short}</Tag>
                </span>
              }
              value={s.tokens}
              max={peak || 1}
              raw={
                <span>
                  {fmtTokens(s.tokens)}
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--muted-2)' }}>{s.sessions} sessions</span>
                </span>
              }
            />
          );
        })}
      </div>
    </Card>
  );
}
