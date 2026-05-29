'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deckApi } from '@/lib/api';
import type { DeckHealth, DeckSession, DeckStats, ToolSummary, TokenStats } from '@/lib/types';
import { sourceMeta, sourceTone, shortTitle, relTime } from '@/lib/format';
import {
  MessageSquare, Terminal, Bot, ChevronRight, Activity, Wrench, Sparkles, Plug, Boxes,
  HeartPulse, Database, Hash, Cpu, BarChart3, Server, Layers, Radio,
  ArrowDownRight, ArrowUpRight, DollarSign, Zap, TrendingUp, CalendarDays, Flame, Clock,
  GitBranch,
} from 'lucide-react';
import {
  Page, Card, Kicker, Tag, MetricCard, BarRow, Sparkline, Btn, SectionHead, Kbd, Chip, type Tone,
} from '@/components/Brand';
import { Globe } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';
import {
  DASHBOARD_ACTIVITY_HOURS,
  buildSessionAggregates,
  buildToolBreakdown,
  fmtCost,
  fmtTokens,
  formatUptime,
  pct,
} from './_lib/dashboard';

export default function HomePage() {
  const t = useT({
    zh: {
      kickerCommandDeck: '指挥台',
      heroTitle: 'Hermes 控制台',
      heroDescPre: '多会话聊天工作台。配置、运行、工具与安全终端集中于一处。所有数据均来自 Hermes 原生 ',
      heroDescMid: ' 与 API Server —— 前端零硬编码。',
      openChat: '打开对话',
      openTerminal: '打开终端',
      statusConnected: '已连接',
      statusDegraded: '降级运行',
      statusDisconnected: '已断开',
      statusChecking: '检测中',
      profileTag: '配置 · ',
      scopeAllChip: '全部 Profile',
      scopeAll: '全部',
      kickerHermesApi: 'HERMES API',
      kickerProfiles: '配置档案',
      kickerSessions: '会话',
      kickerMessages: '消息',
      kickerToolsSkills: '工具 / 技能',
      valHealthy: '健康',
      valFallback: '降级',
      subActivePrefix: '当前 · ',
      subDefault: '默认',
      sub24h: (n: number) => `24小时 · ${n}`,
      subRecentTotal: (recent: number, day: number) => `近期 ${recent} · 24小时 ${day}`,
      sub24hMsgs: (n: number) => `24小时 · ${n}`,
      subFromRecent: (n: number) => `源自最近 ${n} 个会话`,
      subDynamic: '动态发现',
      kicker24hActivity: '24 小时活跃度',
      titleHeatmap: '会话热力图',
      tagRecentHourly: (n: number) => `近期 ${n} · 按小时`,
      ariaLast24h: '近 24 小时活跃度',
      tickMinus24h: '−24小时',
      tickMinus18h: '−18小时',
      tickMinus12h: '−12小时',
      tickMinus6h: '−6小时',
      tickNow: '现在',
      label24hSessions: '24小时会话数',
      labelPeakHour: '高峰时段',
      labelTotalMessages: '消息总数',
      detailPctOfTotal: (p: number) => `占总量 ${p}%`,
      detailNoData: '暂无数据',
      heatmapEmpty: '该 profile 近 24 小时暂无会话活动',
      detailSessionsCount: (n: number) => `${n} 个会话`,
      detailAcrossSessions: (n: number) => `跨 ${n} 个会话`,
      sessionUpdates: (n: number) => `${n} 次会话更新`,
      ariaHourBar: (hoursAgo: number, n: number) =>
        hoursAgo === 0 ? `当前小时：${n} 次会话更新` : `${hoursAgo} 小时前：${n} 次会话更新`,
      kickerExecContexts: '执行上下文',
      titleProfiles: '配置档案',
      contexts: (n: number) => `${n} 个上下文`,
      tagActive: '当前',
      modelFromHermes: '由 Hermes 提供模型',
      gatewayNa: '网关未知',
      noProfile: '未发现配置 —— 当前运行于默认上下文。',
      kickerRecent: (n: number, total: string) => `近期 · ${n} / ${total}`,
      titleRecentSessions: '近期会话',
      openChatLink: '打开对话',
      noSessions: '尚无会话。在对话页发送消息即可创建第一个会话。',
      kickerSourceDist: '来源分布',
      titleSessionsBySource: '按来源分布',
      channels: (n: number) => `${n} 个渠道`,
      noSourceData: '暂无来源数据。',
      kickerWorkload: '配置负载',
      titleProfileWorkload: '配置工作量',
      profilesCount: (n: number) => `${n} 个配置`,
      noWorkload: '暂无配置工作量数据。',
      kickerCapabilities: '能力清单',
      titleToolCategories: '工具分类',
      items: (n: number) => `${n} 项`,
      cliNoTools: 'CLI 未返回工具 / 技能列表。',
      kickerQuickActions: '快捷操作',
      titleShortcuts: '快捷方式',
      live: '实时',
      tileNewChat: '新建对话',
      tileNewChatSub: 'SSE · 多会话',
      tileSwitchProfile: '切换配置',
      tileCapabilities: '能力',
      tileCapabilitiesSub: '工具 · 技能 · MCP',
      tileRunTimeline: '运行时间线',
      tileRunTimelineSub: 'SSE 事件流',
      tileSafeTerminal: '安全终端',
      tileSafeTerminalSub: '允许列表命令',
      tileSettings: '设置',
      tileSettingsSub: '主题 · 偏好',
      kickerRuntimeMeta: '运行时元数据',
      titleSystemInfo: '系统信息',
      hermesBff: 'Hermes BFF',
      kvHermesVersion: 'Hermes 版本',
      kvApiServer: 'API Server',
      kvDeckUptime: 'Deck 运行时长',
      kvStreaming: '流式传输',
      kvState: '状态',
      streamingValue: 'SSE · response.delta · run-event · done',
      unknown: '未知',
      kickerTokenAllTime: '令牌用量 · 累计',
      tokens: '令牌',
      cost: '成本',
      sessionsLabel: (n: string) => `${n} 个会话`,
      apiCallsLabel: (n: string) => `${n} 次 API 调用`,
      splitInput: '输入',
      splitOutput: '输出',
      splitCacheRead: '缓存读取',
      splitReasoning: '推理',
      kickerLast24h: '近 24 小时',
      kicker14dTotal: '14 天累计',
      sessionsShort: (n: number) => `${n} 个会话`,
      rollingWindow: '滚动窗口',
      kicker14dTrend: '14 天令牌趋势',
      ariaTokenUsage14d: '14 天令牌用量',
      tickMinus14d: '−14天',
      tickMinus7d: '−7天',
      kickerTokenTrend: '令牌趋势',
      titleDailyIO: '每日输入 / 输出',
      windowDays: (n: number) => `${n} 天窗口`,
      ariaDailyStacked: '每日输入/输出堆叠图',
      windowCost: '窗口成本',
      kickerActivityRhythm: '活跃节奏',
      titleUsageCadence: '使用节奏',
      byHourWeekday: '按小时 / 星期',
      kickerWeekday: '按星期分布',
      peakDay: (day: string, tok: string) => ({ day, tok }),
      labelPeakPrefix: '高峰 ',
      labelPeakTokens: ' 令牌',
      kickerHourly: '小时分布 (0–23)',
      ariaHourlyTokens: '每小时令牌用量',
      labelPeakHourSuffix: ' 令牌',
      kickerByModel: '按模型',
      titleTopModels: '热门模型 · 14 天',
      viewAll: '查看全部',
      kickerBySource: '按来源',
      titleTopSources: '热门来源 · 14 天',
      tokenView: '令牌视图',
      noTokenUsage: '窗口期内无令牌用量。',
      noSourceRecords: '窗口期内无来源记录。',
      sessionsPlain: (n: number) => `${n} 个会话`,
      dayNames: ['一', '二', '三', '四', '五', '六', '日'],
      dash: '—',
    },
    en: {
      kickerCommandDeck: 'COMMAND DECK',
      heroTitle: 'Hermes control deck',
      heroDescPre: 'Multi-session chat workbench. Profiles, Runs, Tools and the safe terminal in one console. All data sourced from Hermes-native ',
      heroDescMid: ' and API Server — zero hard-coding in the frontend.',
      openChat: 'Open chat',
      openTerminal: 'Open terminal',
      statusConnected: 'Connected',
      statusDegraded: 'Degraded',
      statusDisconnected: 'Disconnected',
      statusChecking: 'Checking',
      profileTag: 'profile · ',
      scopeAllChip: 'All profiles',
      scopeAll: 'ALL',
      kickerHermesApi: 'HERMES API',
      kickerProfiles: 'PROFILES',
      kickerSessions: 'SESSIONS',
      kickerMessages: 'MESSAGES',
      kickerToolsSkills: 'TOOLS / SKILLS',
      valHealthy: 'Healthy',
      valFallback: 'Fallback',
      subActivePrefix: 'active · ',
      subDefault: 'default',
      sub24h: (n: number) => `24h · ${n}`,
      subRecentTotal: (recent: number, day: number) => `recent ${recent} · 24h ${day}`,
      sub24hMsgs: (n: number) => `24h · ${n}`,
      subFromRecent: (n: number) => `from recent ${n} sessions`,
      subDynamic: 'dynamic discovery',
      kicker24hActivity: '24 HOUR ACTIVITY',
      titleHeatmap: 'Session heatmap',
      tagRecentHourly: (n: number) => `recent ${n} · hourly`,
      ariaLast24h: 'Last 24h activity',
      tickMinus24h: '−24h',
      tickMinus18h: '−18h',
      tickMinus12h: '−12h',
      tickMinus6h: '−6h',
      tickNow: 'now',
      label24hSessions: '24H SESSIONS',
      labelPeakHour: 'PEAK HOUR',
      labelTotalMessages: 'TOTAL MESSAGES',
      detailPctOfTotal: (p: number) => `${p}% of total`,
      detailNoData: 'no data',
      heatmapEmpty: 'No session activity in this profile’s last 24h',
      detailSessionsCount: (n: number) => `${n} sessions`,
      detailAcrossSessions: (n: number) => `across ${n} sessions`,
      sessionUpdates: (n: number) => `${n} session updates`,
      ariaHourBar: (hoursAgo: number, n: number) =>
        hoursAgo === 0 ? `Current hour: ${n} session updates` : `${hoursAgo}h ago: ${n} session updates`,
      kickerExecContexts: 'EXECUTION CONTEXTS',
      titleProfiles: 'Profiles',
      contexts: (n: number) => `${n} contexts`,
      tagActive: 'active',
      modelFromHermes: 'model from Hermes',
      gatewayNa: 'gateway n/a',
      noProfile: 'No profile found — running in default context.',
      kickerRecent: (n: number, total: string) => `RECENT · ${n} OF ${total}`,
      titleRecentSessions: 'Recent sessions',
      openChatLink: 'Open chat',
      noSessions: 'No sessions yet. Send a message in chat to create your first one.',
      kickerSourceDist: 'SOURCE DISTRIBUTION',
      titleSessionsBySource: 'Sessions by source',
      channels: (n: number) => `${n} channels`,
      noSourceData: 'No source data yet.',
      kickerWorkload: 'WORKLOAD BY PROFILE',
      titleProfileWorkload: 'Profile workload',
      profilesCount: (n: number) => `${n} profiles`,
      noWorkload: 'No profile workload data yet.',
      kickerCapabilities: 'CAPABILITIES',
      titleToolCategories: 'Tool categories',
      items: (n: number) => `${n} items`,
      cliNoTools: 'CLI returned no tools / skills list.',
      kickerQuickActions: 'QUICK ACTIONS',
      titleShortcuts: 'Shortcuts',
      live: 'live',
      tileNewChat: 'New chat',
      tileNewChatSub: 'SSE · multi-session',
      tileSwitchProfile: 'Switch profile',
      tileCapabilities: 'Capabilities',
      tileCapabilitiesSub: 'tools · skills · MCP',
      tileRunTimeline: 'Run timeline',
      tileRunTimelineSub: 'SSE event stream',
      tileSafeTerminal: 'Safe terminal',
      tileSafeTerminalSub: 'allow-listed cmds',
      tileSettings: 'Settings',
      tileSettingsSub: 'theme · prefs',
      kickerRuntimeMeta: 'RUNTIME METADATA',
      titleSystemInfo: 'System info',
      hermesBff: 'Hermes BFF',
      kvHermesVersion: 'Hermes Version',
      kvApiServer: 'API Server',
      kvDeckUptime: 'Deck Uptime',
      kvStreaming: 'Streaming',
      kvState: 'State',
      streamingValue: 'SSE · response.delta · run-event · done',
      unknown: 'unknown',
      kickerTokenAllTime: 'TOKEN USAGE · ALL TIME',
      tokens: 'tokens',
      cost: 'cost',
      sessionsLabel: (n: string) => `${n} sessions`,
      apiCallsLabel: (n: string) => `${n} api calls`,
      splitInput: 'Input',
      splitOutput: 'Output',
      splitCacheRead: 'Cache read',
      splitReasoning: 'Reasoning',
      kickerLast24h: 'LAST 24H',
      kicker14dTotal: '14D TOTAL',
      sessionsShort: (n: number) => `${n} sessions`,
      rollingWindow: 'rolling window',
      kicker14dTrend: '14D TOKEN TREND',
      ariaTokenUsage14d: '14-day token usage',
      tickMinus14d: '−14d',
      tickMinus7d: '−7d',
      kickerTokenTrend: 'TOKEN TREND',
      titleDailyIO: 'Daily input / output',
      windowDays: (n: number) => `${n}d window`,
      ariaDailyStacked: 'Daily input/output stacked chart',
      windowCost: 'window cost',
      kickerActivityRhythm: 'ACTIVITY RHYTHM',
      titleUsageCadence: 'Usage cadence',
      byHourWeekday: 'by hour / weekday',
      kickerWeekday: 'WEEKDAY DISTRIBUTION',
      peakDay: (day: string, tok: string) => ({ day, tok }),
      labelPeakPrefix: 'peak ',
      labelPeakTokens: ' tokens',
      kickerHourly: 'HOURLY (0–23)',
      ariaHourlyTokens: 'Hourly token usage',
      labelPeakHourSuffix: ' tokens',
      kickerByModel: 'BY MODEL',
      titleTopModels: 'Top models · 14d',
      viewAll: 'View all',
      kickerBySource: 'BY SOURCE',
      titleTopSources: 'Top sources · 14d',
      tokenView: 'token view',
      noTokenUsage: 'No token usage in window.',
      noSourceRecords: 'No source records in window.',
      sessionsPlain: (n: number) => `${n} sessions`,
      dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      dash: '—',
    },
  });

  const { activeProfile, profiles, hydrated } = useActiveProfile();
  /** Dashboard scope. 'active' = filter sessions/stats by the active profile;
   *  'all' = global aggregate (the previous behavior). The toggle lives next
   *  to the hero so the "scope" of the headline numbers stays obvious. */
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [health, setHealth] = useState<DeckHealth | null>(null);
  const [sessions, setSessions] = useState<DeckSession[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [tokens, setTokens] = useState<TokenStats | null>(null);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    const profileForScope = scope === 'active' ? activeProfile : undefined;
    // Track in-flight requests so an older slow response can't overwrite a
    // newer one. Without this, a Hermes that briefly stalls causes the
    // dashboard to flicker between old and new values as resolutions arrive
    // out of order.
    let seq = 0;
    let inflight: AbortController | null = null;
    async function load() {
      seq += 1;
      const mySeq = seq;
      // Cancel any older in-flight tick.
      inflight?.abort();
      const ac = new AbortController();
      inflight = ac;
      try {
        const [h, s, tl, k, st] = await Promise.allSettled([
          deckApi.health(ac.signal),
          // The recent-sessions sample (heatmap, spark stats, recent list) is
          // always the *active* profile's threads — never silently 'default'.
          // The scope toggle drives only the aggregate `stats` request below.
          deckApi.sessions(activeProfile || 'default', ac.signal),
          deckApi.tools(ac.signal),
          deckApi.tokens(14, ac.signal),
          deckApi.stats(profileForScope, ac.signal),
        ]);
        if (!alive || mySeq !== seq) return;
        if (h.status === 'fulfilled') setHealth(h.value);
        if (s.status === 'fulfilled') setSessions(s.value.sessions);
        if (tl.status === 'fulfilled') setTools(tl.value.tools);
        if (k.status === 'fulfilled') setTokens(k.value);
        if (st.status === 'fulfilled') setStats(st.value);
        setNow(Date.now());
      } finally {
        if (alive && mySeq === seq) setLoading(false);
      }
    }
    load();
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id == null) id = setInterval(load, 15000); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else { stop(); }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      stop();
      inflight?.abort();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hydrated, scope, activeProfile]);

  const statusTone: Tone = health?.status === 'connected' ? 'green' : health?.status === 'degraded' ? 'yellow' : 'red';
  const statusLabel = health?.status === 'connected' ? t.statusConnected
    : health?.status === 'degraded' ? t.statusDegraded
    : health ? t.statusDisconnected : t.statusChecking;
  // Resolve the active-profile metadata for display (badges, "active · X" subs).
  // Falls back to the server-marked active profile when the global active id
  // doesn't match (e.g. profile was renamed/removed).
  const activeProfileMeta = useMemo(
    () => profiles.find((p) => p.id === activeProfile) || profiles.find((p) => p.active) || null,
    [profiles, activeProfile],
  );
  // Headline metrics are fetched scoped to `scope`. Surface that in every
  // metric kicker so a single profile's totals can't be mistaken for an
  // all-profiles aggregate (and vice-versa).
  const scopeLabel = scope === 'all' ? t.scopeAll : (activeProfileMeta?.name || activeProfile);

  // Coalesce all six session-derived metrics into a single linear scan.
  // The previous code traversed `sessions` six separate times every render
  // (totalMessages, lastDayCount, sourceBreakdown, profileBreakdown, activity,
  // and peak). For dashboards with many sessions that's wasteful; one pass
  // does it all and the dependent useMemos slot off pre-aggregated fields.
  const sessionAggregates = useMemo(() => {
    return buildSessionAggregates(sessions, now, DASHBOARD_ACTIVITY_HOURS);
  }, [sessions, now]);

  const totalMessages = sessionAggregates.totalMessages;
  const lastDayCount = sessionAggregates.lastDayCount;
  const sourceBreakdown = useMemo(
    () => Array.from(sessionAggregates.sourceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([source, count]) => ({ source, count })),
    [sessionAggregates],
  );
  const profileBreakdown = useMemo(
    () => Array.from(sessionAggregates.profileMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => {
        const p = profiles.find((x) => x.id === id);
        return { id, name: p?.name || id, active: !!p?.active, count };
      }),
    [sessionAggregates, profiles],
  );
  const toolBreakdown = useMemo(() => buildToolBreakdown(tools), [tools]);
  const activity = useMemo(
    () => ({ buckets: sessionAggregates.buckets, peak: sessionAggregates.peak }),
    [sessionAggregates.buckets, sessionAggregates.peak],
  );

  const peakHour = useMemo(() => {
    let max = 0;
    let idx = -1;
    activity.buckets.forEach((v, i) => { if (v > max) { max = v; idx = i; } });
    if (idx < 0) return t.dash;
    const d = new Date(now - (DASHBOARD_ACTIVITY_HOURS - 1 - idx) * 3600 * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  }, [activity, now, t.dash]);

  const avgMsgsPerSession = sessions.length === 0 ? 0
    : Math.round((totalMessages / sessions.length) * 10) / 10;

  // The recent-sessions sample is always the active profile's threads — so
  // "recent N of M" must compare against THAT profile's total, not the
  // scope-wide aggregate, or the two numbers won't reconcile under scope=all.
  const activeProfileSessionTotal = useMemo(() => {
    const fromStats = stats?.perProfile.find((p) => p.profileId === activeProfile)?.sessions;
    return fromStats ?? sessions.length;
  }, [stats, activeProfile, sessions.length]);

  return (
    <Page>
      {/* Hero */}
      <Card hero padding={22}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Kicker style={{ marginBottom: 8 }}>{t.kickerCommandDeck}</Kicker>
            <h1 style={{ fontSize: 'clamp(24px, 2.8vw, 30px)', lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.035em', color: 'var(--strong-text)', margin: '0 0 8px' }}>
              {t.heroTitle}
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              {t.heroDescPre}<Kbd>state.db</Kbd>{t.heroDescMid}
            </p>
          </div>
          <Tag variant={statusTone} icon={<Activity size={11} />}>{statusLabel}</Tag>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" style={{ textDecoration: 'none' }}>
            <Btn variant="primary" icon={<MessageSquare size={14} />}>{t.openChat}</Btn>
          </Link>
          <Link href="/terminal" style={{ textDecoration: 'none' }}>
            <Btn icon={<Terminal size={14} />}>{t.openTerminal}</Btn>
          </Link>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Chip active={scope === 'active'} onClick={() => setScope('active')} icon={<Bot size={11} />}>
              {activeProfileMeta?.name || activeProfile}
            </Chip>
            <Chip active={scope === 'all'} onClick={() => setScope('all')} icon={<Globe size={11} />}>
              {t.scopeAllChip}
            </Chip>
          </span>
        </div>
      </Card>

      {/* 5 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker={t.kickerHermesApi}
          value={loading ? t.dash : health?.apiServer.healthy ? t.valHealthy : t.valFallback}
          sub={health?.apiServer.baseUrl || t.dash}
        />
        <MetricCard
          kicker={t.kickerProfiles}
          value={loading ? t.dash : profiles.length}
          sub={activeProfileMeta?.name ? `${t.subActivePrefix}${activeProfileMeta.name}` : t.subDefault}
        />
        <MetricCard
          kicker={`${t.kickerSessions} · ${scopeLabel}`}
          value={loading ? t.dash : (stats?.totalSessions ?? sessions.length).toLocaleString()}
          sub={stats ? t.sub24h(stats.activeSessions24h) : t.subRecentTotal(sessions.length, lastDayCount)}
        />
        <MetricCard
          kicker={`${t.kickerMessages} · ${scopeLabel}`}
          value={loading ? t.dash : (stats?.totalMessages ?? totalMessages).toLocaleString()}
          sub={stats ? t.sub24hMsgs(stats.activeMessages24h) : t.subFromRecent(sessions.length)}
        />
        <MetricCard
          kicker={t.kickerToolsSkills}
          value={loading ? t.dash : tools.length}
          sub={toolBreakdown.map((b) => `${b.kind} ${b.count}`).join(' · ') || t.subDynamic}
        />
      </div>

      {/* 24h activity */}
      <Card>
        <SectionHead
          kicker={t.kicker24hActivity}
          title={t.titleHeatmap}
          right={
            <Tag icon={<BarChart3 size={11} />}>
              {(activeProfileMeta?.name || activeProfile)} · {t.tagRecentHourly(sessions.length)}
            </Tag>
          }
        />
        {!loading && activity.peak === 0 ? (
          <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-2)', fontSize: 12 }}>
            {t.heatmapEmpty}
          </div>
        ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96, paddingTop: 4 }} role="group" aria-label={t.ariaLast24h}>
          {activity.buckets.map((v, i) => {
            const pctVal = activity.peak === 0 ? 0 : (v / activity.peak) * 100;
            const isPeak = v > 0 && v === activity.peak;
            const hoursAgo = activity.buckets.length - 1 - i;
            return (
              <div
                key={i}
                role="img"
                aria-label={t.ariaHourBar(hoursAgo, v)}
                title={t.sessionUpdates(v)}
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
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted-2)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          <span>{t.tickMinus24h}</span><span>{t.tickMinus18h}</span><span>{t.tickMinus12h}</span><span>{t.tickMinus6h}</span><span>{t.tickNow}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          <SparkStat
            label={t.label24hSessions}
            value={loading ? t.dash : lastDayCount}
            detail={sessions.length ? t.detailPctOfTotal(pct(lastDayCount, sessions.length)) : t.detailNoData}
          />
          <SparkStat
            label={t.labelPeakHour}
            value={peakHour}
            detail={activity.peak ? t.detailSessionsCount(activity.peak) : t.dash}
          />
          <SparkStat
            label={t.labelTotalMessages}
            value={loading ? t.dash : totalMessages.toLocaleString()}
            detail={sessions.length ? t.detailAcrossSessions(sessions.length) : t.dash}
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
            kicker={t.kickerExecContexts}
            title={t.titleProfiles}
            right={
              <Link href="/profiles" style={{ textDecoration: 'none' }}>
                <Tag>{t.contexts(profiles.length)}</Tag>
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
                    {p.active && <Tag variant="green">{t.tagActive}</Tag>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Cpu size={11} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.model || t.modelFromHermes}
                    </span>
                    <span style={{ opacity: .5 }}>·</span>
                    <GitBranch size={11} />
                    <span>{p.gateway || t.gatewayNa}</span>
                  </div>
                </div>
                <Kbd>{p.id}</Kbd>
              </div>
            ))}
            {!loading && profiles.length === 0 && (
              <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                {t.noProfile}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionHead
            kicker={t.kickerRecent(sessions.length, activeProfileSessionTotal.toLocaleString())}
            title={t.titleRecentSessions}
            right={
              <Link href="/chat" style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {t.openChatLink} <ChevronRight size={12} />
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
                    <Tag variant={sourceTone(meta.tone)}>{meta.short}</Tag>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {shortTitle(s.title, 40)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {s.model || t.dash}{time && <> · <Clock size={10} style={{ verticalAlign: -1 }} /> {time}</>}
                      </div>
                    </div>
                  </div>
                  <Kbd>{s.messageCount ?? 0}</Kbd>
                </Link>
              );
            })}
            {!loading && sessions.length === 0 && (
              <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                {t.noSessions}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Source distribution + Profile workload */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker={`${t.kickerSourceDist} · ${scopeLabel}`}
            title={t.titleSessionsBySource}
            right={
              <Tag>
                {t.channels(stats?.perSource.length ?? sourceBreakdown.length)}
              </Tag>
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
            {!loading && (() => {
              const series = stats?.perSource.map((x) => ({ source: x.source, count: x.sessions })) ?? sourceBreakdown;
              const total = stats?.totalSessions ?? sessions.length;
              if (series.length === 0) {
                return <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>{t.noSourceData}</div>;
              }
              return series.slice(0, 8).map(({ source, count }) => {
                const meta = sourceMeta(source);
                return (
                  <BarRow
                    key={source}
                    label={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Tag variant={sourceTone(meta.tone)}>{meta.short}</Tag>
                      </span>
                    }
                    value={count}
                    max={total || 1}
                    raw={`${count} · ${pct(count, total || 0)}%`}
                  />
                );
              });
            })()}
          </div>
        </Card>

        <Card>
          <SectionHead
            kicker={`${t.kickerWorkload} · ${scopeLabel}`}
            title={t.titleProfileWorkload}
            right={
              <Tag>
                {t.profilesCount(stats?.perProfile.length ?? profileBreakdown.length)}
              </Tag>
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
            {!loading && (() => {
              const series = stats?.perProfile.map((x) => {
                const p = profiles.find((pp) => pp.id === x.profileId);
                return { id: x.profileId, name: p?.name || x.profileId, active: !!p?.active, count: x.sessions };
              }) ?? profileBreakdown;
              const total = stats?.totalSessions ?? sessions.length;
              if (series.length === 0) {
                return <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>{t.noWorkload}</div>;
              }
              return series.map(({ id, name, active, count }) => (
                <BarRow
                  key={id}
                  label={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Bot size={11} style={{ color: active ? 'var(--accent)' : 'var(--muted)' }} />
                      <span style={{ fontSize: 11.5 }}>{name}</span>
                      {active && <Tag variant="green" style={{ padding: '0 5px', fontSize: 9 }}>{t.tagActive}</Tag>}
                    </span>
                  }
                  value={count}
                  max={total || 1}
                  raw={`${count} · ${pct(count, total || 0)}%`}
                />
              ));
            })()}
          </div>
        </Card>
      </div>

      {/* Capabilities + Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card>
          <SectionHead
            kicker={t.kickerCapabilities}
            title={t.titleToolCategories}
            right={
              <Link href="/tools" style={{ textDecoration: 'none' }}>
                <Tag>{t.items(tools.length)}</Tag>
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
                {t.cliNoTools}
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
            kicker={t.kickerQuickActions}
            title={t.titleShortcuts}
            right={<Tag variant="green" icon={<Radio size={11} />}>{t.live}</Tag>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <ActionTile href="/chat" icon={<MessageSquare size={14} />} title={t.tileNewChat} sub={t.tileNewChatSub} />
            <ActionTile href="/profiles" icon={<Bot size={14} />} title={t.tileSwitchProfile} sub={t.contexts(profiles.length)} />
            <ActionTile href="/tools" icon={<Wrench size={14} />} title={t.tileCapabilities} sub={t.tileCapabilitiesSub} />
            <ActionTile href="/runs" icon={<Layers size={14} />} title={t.tileRunTimeline} sub={t.tileRunTimelineSub} />
            <ActionTile href="/terminal" icon={<Terminal size={14} />} title={t.tileSafeTerminal} sub={t.tileSafeTerminalSub} />
            <ActionTile href="/settings" icon={<Server size={14} />} title={t.tileSettings} sub={t.tileSettingsSub} />
          </div>
        </Card>
      </div>

      {/* System info */}
      <Card>
        <SectionHead
          kicker={t.kickerRuntimeMeta}
          title={t.titleSystemInfo}
          right={<Tag icon={<Server size={11} />}>{t.hermesBff}</Tag>}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <KvRow first label={t.kvHermesVersion} value={loading ? t.dash : (health?.version || t.unknown)} />
          <KvRow
            label={t.kvApiServer}
            value={
              <>
                {health?.apiServer.baseUrl || t.dash}
                {health?.apiServer.detail && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>· {health.apiServer.detail.slice(0, 60)}</span>
                )}
              </>
            }
          />
          <KvRow label={t.kvDeckUptime} value={health?.uptimeSeconds != null ? formatUptime(health.uptimeSeconds) : t.dash} />
          <KvRow label={t.kvStreaming} value={<>{t.streamingValue}</>} />
          <KvRow label={t.kvState} value={<>~/.hermes/state.db · ~/.hermes/profiles/&lt;id&gt;/state.db</>} />
        </div>
      </Card>
    </Page>
  );
}

// ───────────────────────── Sub-components ─────────────────────────

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
  const t = useT({
    zh: {
      kickerTokenAllTime: '令牌用量 · 累计',
      tokens: '令牌',
      cost: '成本',
      sessionsLabel: (n: string) => `${n} 个会话`,
      apiCallsLabel: (n: string) => `${n} 次 API 调用`,
      splitInput: '输入',
      splitOutput: '输出',
      splitCacheRead: '缓存读取',
      splitReasoning: '推理',
      kickerLast24h: '近 24 小时',
      kicker14dTotal: '14 天累计',
      sessionsShort: (n: number) => `${n} 个会话`,
      rollingWindow: '滚动窗口',
      kicker14dTrend: '14 天令牌趋势',
      ariaTokenUsage14d: '14 天令牌用量',
      tickMinus14d: '−14天',
      tickMinus7d: '−7天',
      tickNow: '现在',
      dash: '—',
    },
    en: {
      kickerTokenAllTime: 'TOKEN USAGE · ALL TIME',
      tokens: 'tokens',
      cost: 'cost',
      sessionsLabel: (n: string) => `${n} sessions`,
      apiCallsLabel: (n: string) => `${n} api calls`,
      splitInput: 'Input',
      splitOutput: 'Output',
      splitCacheRead: 'Cache read',
      splitReasoning: 'Reasoning',
      kickerLast24h: 'LAST 24H',
      kicker14dTotal: '14D TOTAL',
      sessionsShort: (n: number) => `${n} sessions`,
      rollingWindow: 'rolling window',
      kicker14dTrend: '14D TOKEN TREND',
      ariaTokenUsage14d: '14-day token usage',
      tickMinus14d: '−14d',
      tickMinus7d: '−7d',
      tickNow: 'now',
      dash: '—',
    },
  });

  const tt = tokens?.totals;
  const day = tokens?.last24h;
  const totalDailyTokens = (tokens?.daily || []).reduce((s, d) => s + d.total, 0);
  const sparkPeak = (tokens?.daily || []).reduce((m, d) => Math.max(m, d.total), 0);
  const cacheRatio = tt && tt.input > 0 ? Math.round((tt.cacheRead / Math.max(tt.input, 1)) * 100) : 0;

  return (
    <Card hero>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        {/* Left: total + splits */}
        <div>
          <Kicker>{t.kickerTokenAllTime}</Kicker>
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
            {loading || !tt ? t.dash : fmtTokens(tt.total)}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>{t.tokens}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <Tag icon={<DollarSign size={11} />}>{t.cost} <b style={{ marginLeft: 4 }}>{loading || !tt ? t.dash : fmtCost(tt.cost)}</b></Tag>
            <Tag icon={<Activity size={11} />}>{t.sessionsLabel(loading || !tt ? t.dash : tt.sessions.toLocaleString())}</Tag>
            <Tag icon={<Zap size={11} />}>{t.apiCallsLabel(loading || !tt ? t.dash : tt.apiCalls.toLocaleString())}</Tag>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SplitBar label={t.splitInput} icon={<ArrowDownRight size={12} />} value={tt?.input || 0} total={tt?.total || 0} fill="var(--accent)" />
            <SplitBar label={t.splitOutput} icon={<ArrowUpRight size={12} />} value={tt?.output || 0} total={tt?.total || 0} fill="var(--green)" />
            {tt && tt.cacheRead > 0 && (
              <SplitBar
                label={t.splitCacheRead}
                icon={<Database size={12} />}
                value={tt.cacheRead}
                total={tt.total}
                fill="var(--cyan)"
                rightExtra={<span style={{ marginLeft: 4, color: 'var(--muted-2)', fontSize: 10 }}>{cacheRatio}%</span>}
              />
            )}
            {tt && tt.reasoning > 0 && (
              <SplitBar label={t.splitReasoning} icon={<Sparkles size={12} />} value={tt.reasoning} total={tt.total} fill="var(--yellow)" />
            )}
          </div>
        </div>

        {/* Right: 24h KPI + 14d sparkline */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Card padding={12}>
              <Kicker>{t.kickerLast24h}</Kicker>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {loading || !day ? t.dash : fmtTokens(day.total)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{loading || !day ? t.dash : t.sessionsShort(day.sessions)}</div>
            </Card>
            <Card padding={12}>
              <Kicker>{t.kicker14dTotal}</Kicker>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {loading || !tokens ? t.dash : fmtTokens(totalDailyTokens)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.rollingWindow}</div>
            </Card>
          </div>
          <Kicker style={{ marginBottom: 6 }}>{t.kicker14dTrend}</Kicker>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }} aria-label={t.ariaTokenUsage14d}>
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
            <span>{t.tickMinus14d}</span><span>{t.tickMinus7d}</span><span>{t.tickNow}</span>
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
  const t = useT({
    zh: {
      kickerTokenTrend: '令牌趋势',
      titleDailyIO: '每日输入 / 输出',
      windowDays: (n: number) => `${n} 天窗口`,
      ariaDailyStacked: '每日输入/输出堆叠图',
      splitInput: '输入',
      splitOutput: '输出',
      windowCost: '窗口成本',
      dash: '—',
    },
    en: {
      kickerTokenTrend: 'TOKEN TREND',
      titleDailyIO: 'Daily input / output',
      windowDays: (n: number) => `${n}d window`,
      ariaDailyStacked: 'Daily input/output stacked chart',
      splitInput: 'Input',
      splitOutput: 'Output',
      windowCost: 'window cost',
      dash: '—',
    },
  });

  const daily = tokens?.daily || [];
  const peak = daily.reduce((m, d) => Math.max(m, d.input + d.output), 0);
  const totalCost = daily.reduce((s, d) => s + d.cost, 0);

  return (
    <Card>
      <SectionHead
        kicker={t.kickerTokenTrend}
        title={t.titleDailyIO}
        right={<Tag icon={<TrendingUp size={11} />}>{t.windowDays(tokens?.windowDays || 14)}</Tag>}
      />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, paddingTop: 4 }} aria-label={t.ariaDailyStacked}>
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
              title={`${d.date}\n${t.splitInput} ${fmtTokens(d.input)}  ${t.splitOutput} ${fmtTokens(d.output)}\n${fmtCost(d.cost)}`}
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
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(56,189,248,.65)' }} /> {t.splitInput}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green)' }} /> {t.splitOutput}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
          {t.windowCost} {loading ? t.dash : fmtCost(totalCost)}
        </span>
      </div>
    </Card>
  );
}

// ───────────────────────── Token hourly heatmap ─────────────────────────

function TokenHourlyHeatmap({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const t = useT({
    zh: {
      kickerActivityRhythm: '活跃节奏',
      titleUsageCadence: '使用节奏',
      byHourWeekday: '按小时 / 星期',
      kickerWeekday: '按星期分布',
      kickerHourly: '小时分布 (0–23)',
      ariaHourlyTokens: '每小时令牌用量',
      peakLabel: '高峰',
      tokensSuffix: '令牌',
      noData: '暂无数据',
      dayNames: ['一', '二', '三', '四', '五', '六', '日'],
      dash: '—',
    },
    en: {
      kickerActivityRhythm: 'ACTIVITY RHYTHM',
      titleUsageCadence: 'Usage cadence',
      byHourWeekday: 'by hour / weekday',
      kickerWeekday: 'WEEKDAY DISTRIBUTION',
      kickerHourly: 'HOURLY (0–23)',
      ariaHourlyTokens: 'Hourly token usage',
      peakLabel: 'peak',
      tokensSuffix: 'tokens',
      noData: 'no data',
      dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      dash: '—',
    },
  });

  const hourly = tokens?.hourly || Array(24).fill(0);
  const weekday = tokens?.weekday || Array(7).fill(0);
  const peakHour = hourly.reduce((m, v) => Math.max(m, v), 0);
  const peakDay = weekday.reduce((m, v) => Math.max(m, v), 0);
  const peakHourIdx = hourly.indexOf(peakHour);
  const peakDayIdx = weekday.indexOf(peakDay);

  return (
    <Card>
      <SectionHead
        kicker={t.kickerActivityRhythm}
        title={t.titleUsageCadence}
        right={<Tag icon={<CalendarDays size={11} />}>{t.byHourWeekday}</Tag>}
      />
      <div style={{ marginBottom: 16 }}>
        <Kicker style={{ marginBottom: 6 }}>{t.kickerWeekday}</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, alignItems: 'flex-end', height: 60 }}>
          {weekday.map((v, i) => {
            const intensity = peakDay ? v / peakDay : 0;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }} title={`${t.dayNames[i]} · ${fmtTokens(v)}`}>
                <div style={{ width: '100%', height: 36, background: 'var(--surface-bg)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--accent)', opacity: 0.12 + intensity * 0.78, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{t.dayNames[i]}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {loading ? t.dash : peakDay > 0 ? <>{t.peakLabel} <b>{t.dayNames[peakDayIdx]}</b> · {fmtTokens(peakDay)} {t.tokensSuffix}</> : t.noData}
        </div>
      </div>

      <div>
        <Kicker style={{ marginBottom: 6 }}>{t.kickerHourly}</Kicker>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }} aria-label={t.ariaHourlyTokens}>
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
          {loading ? t.dash : peakHour > 0 ? <>{t.peakLabel} <b>{peakHourIdx.toString().padStart(2, '0')}:00</b> · {fmtTokens(peakHour)} {t.tokensSuffix}</> : t.noData}
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────── Top models / sources by tokens ─────────────────────────

function TopModelsByTokens({ tokens, loading }: { tokens: TokenStats | null; loading: boolean }) {
  const t = useT({
    zh: {
      kickerByModel: '按模型',
      titleTopModels: '热门模型 · 14 天',
      viewAll: '查看全部',
      noTokenUsage: '窗口期内无令牌用量。',
    },
    en: {
      kickerByModel: 'BY MODEL',
      titleTopModels: 'Top models · 14d',
      viewAll: 'View all',
      noTokenUsage: 'No token usage in window.',
    },
  });

  const models = tokens?.topModels || [];
  const peak = models.reduce((m, x) => Math.max(m, x.tokens), 0);

  return (
    <Card>
      <SectionHead
        kicker={t.kickerByModel}
        title={t.titleTopModels}
        right={
          <Link href="/profiles" style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {t.viewAll} <ChevronRight size={12} />
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
          <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>{t.noTokenUsage}</div>
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
  const t = useT({
    zh: {
      kickerBySource: '按来源',
      titleTopSources: '热门来源 · 14 天',
      tokenView: '令牌视图',
      noSourceRecords: '窗口期内无来源记录。',
      sessionsPlain: (n: number) => `${n} 个会话`,
    },
    en: {
      kickerBySource: 'BY SOURCE',
      titleTopSources: 'Top sources · 14d',
      tokenView: 'token view',
      noSourceRecords: 'No source records in window.',
      sessionsPlain: (n: number) => `${n} sessions`,
    },
  });

  const sources = tokens?.topSources || [];
  const peak = sources.reduce((m, x) => Math.max(m, x.tokens), 0);

  return (
    <Card>
      <SectionHead
        kicker={t.kickerBySource}
        title={t.titleTopSources}
        right={<Tag icon={<Flame size={11} />}>{t.tokenView}</Tag>}
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
          <div style={{ padding: '12px 0', color: 'var(--muted-2)', fontSize: 12 }}>{t.noSourceRecords}</div>
        )}
        {!loading && sources.map((s) => {
          const meta = sourceMeta(s.source);
          return (
            <BarRow
              key={s.source}
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={meta.label}>
                  <Tag variant={sourceTone(meta.tone)}>{meta.short}</Tag>
                </span>
              }
              value={s.tokens}
              max={peak || 1}
              raw={
                <span>
                  {fmtTokens(s.tokens)}
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--muted-2)' }}>{t.sessionsPlain(s.sessions)}</span>
                </span>
              }
            />
          );
        })}
      </div>
    </Card>
  );
}
