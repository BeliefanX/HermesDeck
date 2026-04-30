'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deckApi } from '@/lib/api';
import type { DeckHealth, DeckProfile, DeckSession, ToolSummary, TokenStats } from '@/lib/types';
import { sourceMeta, shortTitle, relTime } from '@/lib/format';
import {
  MessageSquare, Terminal, Bot, ChevronRight, Activity, Wrench,
} from 'lucide-react';
import { Page, Card, Kicker, Tag, MetricCard, BarRow, Sparkline, Btn, SectionHead, Kbd } from '@/components/Brand';

const HOURS = 24;

function fmtTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  if (!n) return '$0.00';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
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

  const apiHealthy = health?.apiServer.healthy;
  const statusTone = health?.status === 'connected' ? 'green' : health?.status === 'degraded' ? 'yellow' : 'red';
  const statusLabel = health?.status === 'connected' ? 'Connected'
    : health?.status === 'degraded' ? 'Degraded'
    : health ? 'Disconnected' : 'Checking';
  const activeProfile = profiles.find((p) => p.active);

  const lastDayCount = useMemo(() => {
    const cutoff = now - 24 * 3600 * 1000;
    return sessions.filter((s) => {
      const ts = Date.parse(s.updatedAt || s.createdAt || '');
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
  }, [sessions, now]);

  const dailyCounts = useMemo(() => {
    if (tokens?.daily?.length) {
      return tokens.daily.slice(-14).map((d) => d.sessions || 0);
    }
    // Fall back: compute hourly buckets across the last 24h.
    const buckets = Array.from({ length: HOURS }, () => 0);
    const cutoff = now - HOURS * 3600 * 1000;
    sessions.forEach((s) => {
      const ts = Date.parse(s.updatedAt || s.createdAt || '');
      if (!Number.isFinite(ts) || ts < cutoff) return;
      const idx = HOURS - 1 - Math.floor((now - ts) / (3600 * 1000));
      if (idx >= 0 && idx < HOURS) buckets[idx] += 1;
    });
    return buckets;
  }, [tokens, sessions, now]);

  const peakSessions = Math.max(...dailyCounts, 0);
  const avgSessions = dailyCounts.length
    ? Math.round(dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length)
    : 0;

  const topModels = useMemo(() => {
    if (tokens?.topModels?.length) {
      return tokens.topModels.slice(0, 4).map((m) => ({ name: m.model, count: m.tokens, sessions: m.sessions }));
    }
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      const k = s.model || 'unspecified';
      map.set(k, (map.get(k) || 0) + (s.messageCount || 1));
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count, sessions: 0 }));
  }, [tokens, sessions]);
  const topModelsMax = Math.max(...topModels.map((m) => m.count), 1);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      const k = (s.source || 'hermes').toLowerCase();
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));
  }, [sessions]);

  const profileBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => map.set(s.profileId || 'default', (map.get(s.profileId || 'default') || 0) + 1));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const p = profiles.find((x) => x.id === id);
        return { id, name: p?.name || id, active: !!p?.active, count };
      });
  }, [sessions, profiles]);

  const tokens14d = tokens?.totals.total ?? 0;
  const cost14d = tokens?.totals.cost ?? 0;
  const sessions24hDelta = tokens?.last24h.sessions ?? lastDayCount;

  return (
    <Page>
      {/* Hero */}
      <Card hero padding={22}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Kicker style={{ marginBottom: 8 }}>COMMAND DECK</Kicker>
            <h1
              style={{
                fontSize: 'clamp(24px, 2.8vw, 30px)',
                lineHeight: 1.12,
                fontWeight: 650,
                letterSpacing: '-.035em',
                color: 'var(--strong-text)',
                margin: '0 0 8px',
              }}
            >
              Hermes control deck
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              Multi-session chat workbench. Profiles, Runs, Tools and the safe terminal in one console. All data sourced
              from Hermes-native <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>state.db</span>{' '}
              and API Server — zero hard-coding in the frontend.
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

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker="SESSIONS · 24H"
          value={loading ? '—' : sessions24hDelta}
          sub={sessions.length ? `of ${sessions.length} total` : 'no data yet'}
        />
        <MetricCard
          kicker="TOKENS · 14D"
          value={loading ? '—' : fmtTokens(tokens14d)}
          sub={tokens ? `${fmtTokens(tokens.last24h.total)} last 24h` : 'in / out'}
        />
        <MetricCard
          kicker="COST · 14D"
          value={loading ? '—' : fmtUsd(cost14d)}
          sub={tokens ? `${fmtUsd(tokens.last24h.cost)} last 24h` : 'model spend'}
          deltaTone={tokens && tokens.last24h.cost > 0 ? 'yellow' : 'green'}
        />
        <MetricCard
          kicker="TOOLS · MCP"
          value={loading ? '—' : tools.length}
          sub={apiHealthy ? `API ${health?.apiServer.baseUrl?.replace(/^https?:\/\//, '')}` : 'API offline'}
        />
      </div>

      {/* 2-col: sparkline + top models */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <Kicker>SESSIONS · {tokens?.daily?.length ? `${dailyCounts.length}D` : '24H'}</Kicker>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              {tokens?.daily?.length ? `${dailyCounts.length} days` : '24 hourly buckets'}
            </span>
          </div>
          {dailyCounts.length > 0 ? (
            <Sparkline values={dailyCounts} />
          ) : (
            <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-2)', fontSize: 12 }}>
              No activity yet
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--hairline)',
              flexWrap: 'wrap',
            }}
          >
            <SparkStat label="PEAK" value={peakSessions} />
            <SparkStat label="AVG" value={avgSessions} />
            <SparkStat label="LAST 24H" value={lastDayCount} />
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <Kicker>TOP MODELS · 14D</Kicker>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              {topModels.length} models
            </span>
          </div>
          {topModels.length === 0 ? (
            <div style={{ padding: '18px 0', color: 'var(--muted-2)', fontSize: 12 }}>
              No model usage yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topModels.map((m) => (
                <BarRow
                  key={m.name}
                  label={
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                      {shortTitle(m.name, 20)}
                    </span>
                  }
                  value={m.count}
                  max={topModelsMax}
                  raw={fmtTokens(m.count)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent sessions */}
      <Card>
        <SectionHead
          kicker="RECENT SESSIONS"
          title={<>Recent sessions</>}
          right={
            <Link href="/chat" style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View all <ChevronRight size={12} />
            </Link>
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {loading && sessions.length === 0 && Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 12,
                alignItems: 'center',
                padding: '10px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
              }}
            >
              <div className="skel" style={{ width: '60%', height: 14 }} />
              <div className="skel" style={{ width: 60, height: 14 }} />
              <div className="skel" style={{ width: 14, height: 14 }} />
            </div>
          ))}
          {sessions.slice(0, 5).map((s, i) => {
            const meta = sourceMeta(s.source);
            const time = relTime(s.updatedAt || s.createdAt);
            return (
              <Link
                key={s.id}
                href={`/chat?session=${encodeURIComponent(s.id)}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 550,
                      color: 'var(--strong-text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {shortTitle(s.title, 56)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {s.model || '—'} · {meta.short} · {time || 'pending'}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
                  {s.messageCount ?? 0} msgs
                </span>
                <ChevronRight size={14} style={{ color: 'var(--muted-2)' }} />
              </Link>
            );
          })}
          {!loading && sessions.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
              No sessions yet. Send a message in chat to create your first one.
            </div>
          )}
        </div>
      </Card>

      {/* 2-col: sources + profiles workload */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker="SESSIONS BY SOURCE"
            title="Source distribution"
            right={<Tag>{sourceBreakdown.length} channels</Tag>}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sourceBreakdown.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>
                No source data yet.
              </div>
            ) : sourceBreakdown.map(({ source, count }) => {
              const meta = sourceMeta(source);
              return (
                <BarRow
                  key={source}
                  label={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text)' }}>{meta.label}</span>
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
            {profileBreakdown.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>
                No profile workload data yet.
              </div>
            ) : profileBreakdown.map(({ id, name, active, count }) => (
              <BarRow
                key={id}
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Bot size={11} style={{ color: active ? 'var(--accent)' : 'var(--muted)' }} />
                    <span style={{ fontSize: 11.5 }}>{name}</span>
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

      {/* Capabilities footer */}
      <Card>
        <SectionHead
          kicker="CAPABILITIES"
          title="Tools, skills and MCP servers"
          right={
            <Link href="/tools" style={{ textDecoration: 'none' }}>
              <Btn size="sm" icon={<Wrench size={12} />}>Browse all</Btn>
            </Link>
          }
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {loading && tools.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skel" style={{ width: 90, height: 26, borderRadius: 999 }} />
              ))
            : tools.length === 0
            ? <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Hermes did not return a tools list.</span>
            : tools.slice(0, 18).map((t, i) => (
                <Tag key={`${t.name}-${t.kind}-${i}`} variant={t.kind === 'mcp' ? 'cyan' : t.kind === 'skill' ? 'accent' : 'default'}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{t.name}</span>
                </Tag>
              ))}
        </div>
        {tools.length > 18 && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>
            + {tools.length - 18} more
          </div>
        )}
        {!loading && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
            data · <Kbd>{health?.apiServer.baseUrl || '—'}</Kbd>
          </div>
        )}
      </Card>
    </Page>
  );
}

function SparkStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <Kicker>{label}</Kicker>
      <div
        style={{
          fontSize: 18,
          fontWeight: 650,
          color: 'var(--strong-text)',
          fontVariantNumeric: 'tabular-nums',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}
