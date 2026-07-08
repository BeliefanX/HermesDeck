'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deckApi, apiErrorDetail } from '@/lib/api';
import type { DeckHealth, DeckSession, DeckStats, ToolSummary } from '@/lib/types';
import { sourceMeta, sourceTone, shortTitle, relTime } from '@/lib/format';
import {
  MessageSquare, Terminal, Bot, ChevronRight, Activity, Wrench, Sparkles, Plug, Boxes,
  HeartPulse, Hash, Cpu, BarChart3, Server, Radio, Clock,
  GitBranch,
} from 'lucide-react';
import {
  Page, Card, Kicker, Tag, MetricCard, BarRow, Sparkline, Btn, SectionHead, Kbd, Chip,
} from '@/components/Brand';
import { Globe } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';
import { useDeckSession } from '@/lib/use-deck-session';
import { NoAssignedAgentsState } from '@/components/NoAssignedAgentsState';
import {
  DASHBOARD_ACTIVITY_HOURS,
  buildSessionAggregates,
  buildToolBreakdown,
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
      loadingValue: '加载中',
      loadingDetail: '正在读取 Hermes 状态',
      apiBaseMissing: 'API Server 地址未返回',
      profileTag: 'Agent · ',
      scopeAllChip: '全部 Agent',
      scopeAll: '全部',
      kickerHermesApi: 'HERMES API',
      kickerProfiles: 'Agents',
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
      heatmapEmpty: '该 Agent 近 24 小时暂无会话活动',
      detailSessionsCount: (n: number) => `${n} 个会话`,
      detailAcrossSessions: (n: number) => `跨 ${n} 个会话`,
      sessionUpdates: (n: number) => `${n} 次会话更新`,
      ariaHourBar: (hoursAgo: number, n: number) =>
        hoursAgo === 0 ? `当前小时：${n} 次会话更新` : `${hoursAgo} 小时前：${n} 次会话更新`,
      kickerExecContexts: 'Agents',
      titleProfiles: 'Agents',
      contexts: (n: number) => `${n} 个 Agent`,
      tagActive: '当前',
      modelFromHermes: '由 Hermes 提供模型',
      gatewayNa: '网关未知',
      noProfile: '未发现 Agent —— 当前运行于默认 Agent。',
      kickerRecent: (n: number, total: string) => `近期 · ${n} / ${total}`,
      titleRecentSessions: '近期会话',
      openChatLink: '打开对话',
      noSessions: '尚无会话。在对话页发送消息即可创建第一个会话。',
      kickerWorkbenchState: '工作台状态',
      emptyWorkbenchTitle: '当前没有可汇总的会话',
      emptyWorkbenchDesc: 'Agent 与 API 状态会先显示在这里；发送第一条消息后，活跃度和来源分布会自动填充。',
      emptyProfileReady: 'Agent 已就绪',
      emptyApiReady: 'API Server 正在响应',
      emptySessionReady: 'Chat 尚未产生会话',
      emptyOpenChat: '创建第一条对话',
      emptyReviewProfiles: '检查 Agent',
      kickerSourceDist: '来源分布',
      titleSessionsBySource: '按来源分布',
      channels: (n: number) => `${n} 个渠道`,
      noSourceData: '暂无来源数据。',
      kickerWorkload: 'Agent 负载',
      titleProfileWorkload: 'Agent 工作量',
      profilesCount: (n: number) => `${n} 个 Agent`,
      noWorkload: '暂无 Agent 工作量数据。',
      kickerCapabilities: '能力清单',
      titleToolCategories: '工具分类',
      items: (n: number) => `${n} 项`,
      cliNoTools: 'CLI 未返回工具 / 技能列表。',
      kickerQuickActions: '快捷操作',
      titleShortcuts: '快捷方式',
      live: '实时',
      tileNewChat: '新建对话',
      tileNewChatSub: 'SSE · 多会话',
      tileSwitchProfile: '切换 Agent',
      tileCapabilities: '能力',
      tileCapabilitiesSub: '工具 · 技能 · MCP',
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
      dash: '—',
    },
    en: {
      kickerCommandDeck: 'COMMAND DECK',
      heroTitle: 'Hermes control deck',
      heroDescPre: 'Multi-session chat workbench. Agents, Tools and the safe terminal in one console. All data sourced from Hermes-native ',
      heroDescMid: ' and API Server — zero hard-coding in the frontend.',
      openChat: 'Open chat',
      openTerminal: 'Open terminal',
      loadingValue: 'Loading',
      loadingDetail: 'Reading Hermes state',
      apiBaseMissing: 'API Server URL not returned',
      profileTag: 'Agent · ',
      scopeAllChip: 'All Agents',
      scopeAll: 'ALL',
      kickerHermesApi: 'HERMES API',
      kickerProfiles: 'AGENTS',
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
      heatmapEmpty: 'No session activity in this Agent’s last 24h',
      detailSessionsCount: (n: number) => `${n} sessions`,
      detailAcrossSessions: (n: number) => `across ${n} sessions`,
      sessionUpdates: (n: number) => `${n} session updates`,
      ariaHourBar: (hoursAgo: number, n: number) =>
        hoursAgo === 0 ? `Current hour: ${n} session updates` : `${hoursAgo}h ago: ${n} session updates`,
      kickerExecContexts: 'AGENTS',
      titleProfiles: 'Agents',
      contexts: (n: number) => `${n} Agents`,
      tagActive: 'active',
      modelFromHermes: 'model from Hermes',
      gatewayNa: 'gateway n/a',
      noProfile: 'No Agent found — running with the default Agent.',
      kickerRecent: (n: number, total: string) => `RECENT · ${n} OF ${total}`,
      titleRecentSessions: 'Recent sessions',
      openChatLink: 'Open chat',
      noSessions: 'No sessions yet. Send a message in chat to create your first one.',
      kickerWorkbenchState: 'WORKBENCH STATE',
      emptyWorkbenchTitle: 'No sessions to summarize yet',
      emptyWorkbenchDesc: 'Agent and API health show up first; after your first message, activity and source mix will fill in here.',
      emptyProfileReady: 'Agent is ready',
      emptyApiReady: 'API Server is responding',
      emptySessionReady: 'Chat has not created a session yet',
      emptyOpenChat: 'Create first chat',
      emptyReviewProfiles: 'Review Agents',
      kickerSourceDist: 'SOURCE DISTRIBUTION',
      titleSessionsBySource: 'Sessions by source',
      channels: (n: number) => `${n} channels`,
      noSourceData: 'No source data yet.',
      kickerWorkload: 'WORKLOAD BY AGENT',
      titleProfileWorkload: 'Agent workload',
      profilesCount: (n: number) => `${n} Agents`,
      noWorkload: 'No Agent workload data yet.',
      kickerCapabilities: 'CAPABILITIES',
      titleToolCategories: 'Tool categories',
      items: (n: number) => `${n} items`,
      cliNoTools: 'CLI returned no tools / skills list.',
      kickerQuickActions: 'QUICK ACTIONS',
      titleShortcuts: 'Shortcuts',
      live: 'live',
      tileNewChat: 'New chat',
      tileNewChatSub: 'SSE · multi-session',
      tileSwitchProfile: 'Switch Agent',
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
      dash: '—',
    },
  });

  const { activeProfile, profiles, hydrated } = useActiveProfile();
  const { capabilities } = useDeckSession();
  const canUseTerminal = capabilities.canUseTerminal;
  // Empty `profiles` alone can also mean the authoritative Hermes catalog is
  // temporarily unavailable. In that case ProfileProvider keeps admin/super_admin
  // usable with an RBAC-authorized emergency active profile (usually `default`).
  // Only show the fail-closed assignment empty state when there is no authorized
  // active profile at all.
  const noAssignedAgents = hydrated && profiles.length === 0 && !activeProfile;
  /** Dashboard scope. 'active' = filter sessions/stats by the active profile;
   *  'all' = global aggregate (the previous behavior). The toggle lives next
   *  to the hero so the "scope" of the headline numbers stays obvious. */
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [health, setHealth] = useState<DeckHealth | null>(null);
  const [sessions, setSessions] = useState<DeckSession[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hydrated) return;
    if (noAssignedAgents) {
      setSessions([]);
      setTools([]);
      setStats(null);
      setLoadError('');
      setLoading(false);
      return;
    }
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
        const [h, s, tl, st] = await Promise.allSettled([
          deckApi.health(ac.signal),
          // The recent-sessions sample (heatmap, spark stats, recent list) is
          // always the *active* profile's threads — never silently 'default'.
          // The scope toggle drives only the aggregate `stats` request below.
          deckApi.sessions(activeProfile, ac.signal),
          deckApi.tools(activeProfile, ac.signal),
          deckApi.stats(profileForScope, ac.signal),
        ]);
        if (!alive || mySeq !== seq) return;
        if (h.status === 'fulfilled') setHealth(h.value);
        if (s.status === 'fulfilled') setSessions(s.value.sessions);
        if (tl.status === 'fulfilled') setTools(tl.value.tools);
        if (st.status === 'fulfilled') setStats(st.value);
        const failures: string[] = [];
        if (s.status === 'rejected') failures.push(`sessions: ${apiErrorDetail(s.reason)}`);
        if (st.status === 'rejected') failures.push(`stats: ${apiErrorDetail(st.reason)}`);
        setLoadError(failures.join(' · '));
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
  }, [hydrated, scope, activeProfile, noAssignedAgents]);

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
    if (idx < 0) return t.detailNoData;
    const d = new Date(now - (DASHBOARD_ACTIVITY_HOURS - 1 - idx) * 3600 * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  }, [activity, now, t.detailNoData]);

  const avgMsgsPerSession = sessions.length === 0 ? 0
    : Math.round((totalMessages / sessions.length) * 10) / 10;

  // The recent-sessions sample is always the active profile's threads — so
  // "recent N of M" must compare against THAT profile's total, not the
  // scope-wide aggregate, or the two numbers won't reconcile under scope=all.
  const activeProfileSessionTotal = useMemo(() => {
    const fromStats = stats?.perProfile.find((p) => p.profileId === activeProfile)?.sessions;
    return fromStats ?? sessions.length;
  }, [stats, activeProfile, sessions.length]);
  const scopedTotalSessions = stats?.totalSessions ?? sessions.length;
  const scopedTotalMessages = stats?.totalMessages ?? totalMessages;
  const dashboardIsEmpty = !loading && !loadError && scopedTotalSessions === 0 && sessions.length === 0 && totalMessages === 0;

  if (noAssignedAgents) {
    return (
      <Page>
        <NoAssignedAgentsState />
      </Page>
    );
  }

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
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" style={{ textDecoration: 'none' }}>
            <Btn variant="primary" icon={<MessageSquare size={14} />}>{t.openChat}</Btn>
          </Link>
          {canUseTerminal && (
            <Link href="/terminal" style={{ textDecoration: 'none' }}>
              <Btn icon={<Terminal size={14} />}>{t.openTerminal}</Btn>
            </Link>
          )}
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

      {loadError && (
        <Card>
          <div style={{ color: 'var(--red)', fontSize: 13, lineHeight: 1.5 }}>
            Dashboard data load failed: {loadError}
          </div>
        </Card>
      )}

      {/* 5 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker={t.kickerHermesApi}
          value={loading ? t.loadingValue : health?.apiServer.healthy ? t.valHealthy : t.valFallback}
          sub={loading ? t.loadingDetail : health?.apiServer.baseUrl || t.apiBaseMissing}
        />
        <MetricCard
          kicker={t.kickerProfiles}
          value={loading ? t.loadingValue : profiles.length}
          sub={activeProfileMeta?.name ? `${t.subActivePrefix}${activeProfileMeta.name}` : t.subDefault}
        />
        <MetricCard
          kicker={`${t.kickerSessions} · ${scopeLabel}`}
          value={loading ? t.loadingValue : scopedTotalSessions.toLocaleString()}
          sub={stats ? t.sub24h(stats.activeSessions24h) : t.subRecentTotal(sessions.length, lastDayCount)}
        />
        <MetricCard
          kicker={`${t.kickerMessages} · ${scopeLabel}`}
          value={loading ? t.loadingValue : scopedTotalMessages.toLocaleString()}
          sub={stats ? t.sub24hMsgs(stats.activeMessages24h) : t.subFromRecent(sessions.length)}
        />
        <MetricCard
          kicker={t.kickerToolsSkills}
          value={loading ? t.loadingValue : tools.length}
          sub={toolBreakdown.map((b) => `${b.kind} ${b.count}`).join(' · ') || t.subDynamic}
        />
      </div>

      {dashboardIsEmpty && (
        <Card>
          <SectionHead
            kicker={t.kickerWorkbenchState}
            title={t.emptyWorkbenchTitle}
            right={<Tag icon={<Activity size={11} />}>{scopeLabel}</Tag>}
          />
          <p style={{ margin: 0, maxWidth: 720, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
            {t.emptyWorkbenchDesc}
          </p>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--hairline)' }}>
            <DashboardStateRow
              kicker={t.kickerProfiles}
              title={t.emptyProfileReady}
              detail={activeProfileMeta?.name || activeProfile}
              first
            />
            <DashboardStateRow
              kicker={t.kickerHermesApi}
              title={health?.apiServer.healthy ? t.emptyApiReady : t.valFallback}
              detail={health?.apiServer.baseUrl || t.apiBaseMissing}
            />
            <DashboardStateRow
              kicker={t.kickerSessions}
              title={t.emptySessionReady}
              detail={t.detailNoData}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <Link href="/chat" style={{ textDecoration: 'none' }}>
              <Btn variant="primary" icon={<MessageSquare size={14} />}>{t.emptyOpenChat}</Btn>
            </Link>
            <Link href="/profiles" style={{ textDecoration: 'none' }}>
              <Btn icon={<Bot size={14} />}>{t.emptyReviewProfiles}</Btn>
            </Link>
          </div>
        </Card>
      )}

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
                  background: isPeak ? 'var(--accent)' : v > 0 ? 'var(--accent-strong)' : 'var(--surface-bg)',
                  borderRadius: 2,
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
            value={loading ? t.loadingValue : lastDayCount}
            detail={sessions.length ? t.detailPctOfTotal(pct(lastDayCount, sessions.length)) : t.detailNoData}
          />
          <SparkStat
            label={t.labelPeakHour}
            value={peakHour}
            detail={activity.peak ? t.detailSessionsCount(activity.peak) : t.detailNoData}
          />
          <SparkStat
            label={t.labelTotalMessages}
            value={loading ? t.loadingValue : totalMessages.toLocaleString()}
            detail={sessions.length ? t.detailAcrossSessions(sessions.length) : t.detailNoData}
          />
        </div>
      </Card>

      {/* Profiles + Recent sessions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
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
                        {s.model || t.unknown}{time && <> · <Clock size={10} style={{ verticalAlign: -1 }} /> {time}</>}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
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
          <KvRow first label={t.kvHermesVersion} value={loading ? t.loadingValue : (health?.version || t.unknown)} />
          <KvRow
            label={t.kvApiServer}
            value={
              <>
                {loading ? t.loadingValue : health?.apiServer.baseUrl || t.apiBaseMissing}
                {health?.apiServer.detail && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>· {health.apiServer.detail.slice(0, 60)}</span>
                )}
              </>
            }
          />
          <KvRow label={t.kvDeckUptime} value={loading ? t.loadingValue : health?.uptimeSeconds != null ? formatUptime(health.uptimeSeconds) : t.unknown} />
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

function DashboardStateRow({
  kicker,
  title,
  detail,
  first = false,
}: {
  kicker: string;
  title: React.ReactNode;
  detail: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 180px) 1fr',
        gap: 14,
        padding: '12px 0',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
        alignItems: 'baseline',
      }}
    >
      <Kicker>{kicker}</Kicker>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>{title}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{detail}</div>
      </div>
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
        transition: 'background 200ms cubic-bezier(.2,.7,.2,1), border-color 200ms cubic-bezier(.2,.7,.2,1), color 200ms cubic-bezier(.2,.7,.2,1)',
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
