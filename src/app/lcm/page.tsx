'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { LcmDashboard, LcmProfileStats } from '@/lib/types';
import {
  Activity, AlertCircle, BookOpen, Boxes, Cpu, Database, GitBranch,
  HardDrive, Hash, Layers, Package, RefreshCcw, Server, Sparkles, Wrench,
} from 'lucide-react';
import { Page, Card, Kicker, Tag, MetricCard, BarRow, Sparkline, Btn, SectionHead, Chip } from '@/components/Brand';
import { useT, useLang } from '@/lib/i18n';

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function relTimeFromEpoch(secs: number | null | undefined, lang: 'zh' | 'en'): string {
  if (!secs) return lang === 'zh' ? '—' : '—';
  const now = Date.now() / 1000;
  const d = Math.max(0, now - secs);
  if (d < 60)    return lang === 'zh' ? `${Math.round(d)} 秒前`    : `${Math.round(d)}s ago`;
  if (d < 3600)  return lang === 'zh' ? `${Math.round(d / 60)} 分前`   : `${Math.round(d / 60)}m ago`;
  if (d < 86400) return lang === 'zh' ? `${Math.round(d / 3600)} 小时前` : `${Math.round(d / 3600)}h ago`;
  return lang === 'zh' ? `${Math.round(d / 86400)} 天前` : `${Math.round(d / 86400)}d ago`;
}

export default function LcmPage() {
  const [data, setData] = useState<LcmDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [profileSel, setProfileSel] = useState<string>('');
  // Reactive — every other page reads language via the i18n store so the
  // EN/中 toggle updates them live. This page used a frozen useState snapshot,
  // so its relative timestamps never followed the toggle.
  const lang = useLang();

  const t = useT({
    zh: {
      intro: 'Lossless Context Management — hermes-lcm 插件运行时仪表盘。所有数值直接从 ~/.hermes/lcm.db 及各 Profile 子库读取。',
      kickerPlugin: '插件',
      kickerTools: '工具',
      kickerVersion: '版本',
      kickerGit: 'Git',
      kickerProfiles: 'PROFILE',
      kickerRows: '消息行',
      kickerSessions: '会话',
      kickerTokens: 'Token 估计',
      kickerNodes: '摘要节点',
      kickerDb: '存储占用',
      profileAll: '全部',
      tabOverview: '总览',
      tabActivity: '近 24 小时活动',
      tabSessions: '热门会话',
      tabSummary: 'DAG 摘要',
      tabLifecycle: '生命周期',
      tabConfig: '配置',
      tabHealth: '健康检查',
      tabLargest: '最大行',
      titleRoleDist: '消息角色分布',
      titleSourceDist: '消息来源分布',
      titleHourly: '逐小时入库 · 近 24h',
      titleTopSessions: '会话排行 · 按消息数',
      titleSummaryDepth: '摘要按深度分布',
      titleLifecycle: '会话生命周期状态',
      titleConfig: '插件配置变量',
      titleHealth: 'SQLite 健康',
      titleLargest: '最大单行 · 字节数',
      pluginMissing: '未检测到 hermes-lcm 插件 —— 期望路径：~/.hermes/plugins/hermes-lcm',
      noProfiles: '未发现 LCM 数据库。',
      noData: '暂无数据',
      sessionId: '会话 ID',
      rows: '行数',
      tokens: 'Tokens',
      lastAt: '最近',
      role: '角色',
      source: '来源',
      depth: '深度',
      nodes: '节点',
      debt: '债务',
      env: '环境',
      hermesEnv: 'Hermes ENV',
      default_: '默认',
      key: '键',
      value: '值',
      source2: '来源',
      defaultVal: '默认值',
      journalMode: '日志模式',
      quickCheck: 'quick_check',
      schemaVer: '模式版本',
      walSize: 'WAL 大小',
      dbSize: '主库大小',
      refreshing: '刷新中…',
      refresh: '刷新',
      retry: '重试',
      generatedAt: '生成于',
      loadFailed: '加载失败',
      noLcmRows: '该 Profile 暂无 LCM 数据。',
      lifecycleRows: '生命周期记录',
      totalDebt: '债务字节总计',
      lastFinalized: '上次结案',
      lastRollover: '上次滚动',
      lastMaintenance: '上次维护',
      bytes: '字节',
    },
    en: {
      intro: 'Lossless Context Management — runtime dashboard for the hermes-lcm plugin. Numbers come straight from ~/.hermes/lcm.db and per-profile shards.',
      kickerPlugin: 'PLUGIN',
      kickerTools: 'TOOLS',
      kickerVersion: 'VERSION',
      kickerGit: 'GIT',
      kickerProfiles: 'PROFILE',
      kickerRows: 'MESSAGE ROWS',
      kickerSessions: 'SESSIONS',
      kickerTokens: 'TOKENS (EST.)',
      kickerNodes: 'SUMMARY NODES',
      kickerDb: 'STORAGE',
      profileAll: 'all',
      tabOverview: 'Overview',
      tabActivity: 'Last 24h activity',
      tabSessions: 'Top sessions',
      tabSummary: 'DAG summaries',
      tabLifecycle: 'Lifecycle',
      tabConfig: 'Config',
      tabHealth: 'Health',
      tabLargest: 'Largest rows',
      titleRoleDist: 'Messages by role',
      titleSourceDist: 'Messages by source',
      titleHourly: 'Rows ingested · last 24h',
      titleTopSessions: 'Top sessions by row count',
      titleSummaryDepth: 'Summary nodes by depth',
      titleLifecycle: 'Lifecycle state',
      titleConfig: 'Plugin configuration variables',
      titleHealth: 'SQLite health',
      titleLargest: 'Largest rows · bytes',
      pluginMissing: 'hermes-lcm plugin not detected — expected ~/.hermes/plugins/hermes-lcm',
      noProfiles: 'No LCM databases found.',
      noData: 'No data',
      sessionId: 'Session ID',
      rows: 'Rows',
      tokens: 'Tokens',
      lastAt: 'Last',
      role: 'Role',
      source: 'Source',
      depth: 'Depth',
      nodes: 'Nodes',
      debt: 'Debt',
      env: 'env',
      hermesEnv: 'hermes-env',
      default_: 'default',
      key: 'Key',
      value: 'Value',
      source2: 'Source',
      defaultVal: 'Default',
      journalMode: 'Journal mode',
      quickCheck: 'quick_check',
      schemaVer: 'Schema version',
      walSize: 'WAL size',
      dbSize: 'DB size',
      refreshing: 'Refreshing…',
      refresh: 'Refresh',
      retry: 'Retry',
      generatedAt: 'Generated',
      loadFailed: 'Load failed',
      noLcmRows: 'This profile has no LCM rows.',
      lifecycleRows: 'Lifecycle rows',
      totalDebt: 'Total debt bytes',
      lastFinalized: 'Last finalized',
      lastRollover: 'Last rollover',
      lastMaintenance: 'Last maintenance',
      bytes: 'bytes',
    },
  });

  const load = useMemo(() => async (signal?: AbortSignal) => {
    setLoading(true);
    setErr('');
    try {
      const d = await deckApi.lcm(signal);
      setData(d);
      // Default the selector to the first profile, but only if the user
      // hasn't picked one. Functional update so `load` needn't depend on
      // `profileSel` — depending on it rebuilt the callback after the first
      // fetch and re-fired the effect, triggering a second full lcm fetch.
      setProfileSel((cur) => cur || d.profiles[0]?.profile || '');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setErr((e as Error)?.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const active = data?.profiles.find((p) => p.profile === profileSel) || data?.profiles[0];

  return (
    <Page intro={t.intro}>
      <Card hero padding={20}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(56,189,248,.20), rgba(168,85,247,.20))',
            border: '1px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BookOpen size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Kicker style={{ marginBottom: 4 }}>HERMES-LCM</Kicker>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--strong-text)' }}>
              {data?.plugin.name || 'hermes-lcm'} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 14 }}>v{data?.plugin.version || '—'}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {data?.plugin.description || 'Lossless context management — DAG summaries that never lose a message.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {data?.plugin.installed ? <Tag variant="green" icon={<Package size={11} />}>installed</Tag> : <Tag variant="red" icon={<AlertCircle size={11} />}>not installed</Tag>}
            {data?.plugin.gitBranch && (
              <Tag variant="cyan" icon={<GitBranch size={11} />}>
                {data.plugin.gitBranch}{data.plugin.gitCommit ? ` · ${data.plugin.gitCommit}` : ''}{data.plugin.gitDirty ? ' · dirty' : ''}
              </Tag>
            )}
            <Btn onClick={() => load()} icon={<RefreshCcw size={13} className={loading ? 'spin' : ''} />}>
              {loading ? t.refreshing : t.refresh}
            </Btn>
          </div>
        </div>
        {data && data.plugin.toolsProvided.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.plugin.toolsProvided.map((tool) => (
              <Tag key={tool} variant="accent" icon={<Wrench size={10} />}>{tool}</Tag>
            ))}
          </div>
        )}
      </Card>

      {err && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--red)' }}>
            <AlertCircle size={14} />
            <span style={{ fontSize: 13 }}>{t.loadFailed}: {err}</span>
            <Btn onClick={() => load()}>{t.retry}</Btn>
          </div>
        </Card>
      )}

      {data && !data.plugin.installed && (
        <Card>
          <div style={{ color: 'var(--yellow)', fontSize: 13 }}>{t.pluginMissing}</div>
        </Card>
      )}

      {data && (
        <>
          {/* Headline metrics — aggregate across all profiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <MetricCard kicker={t.kickerRows}     value={fmtNum(data.totals.rows)}        sub={`${data.profiles.length} ${data.profiles.length === 1 ? 'profile' : 'profiles'}`} />
            <MetricCard kicker={t.kickerSessions} value={fmtNum(data.totals.sessions)}    sub={data.totals.sessions ? `${(data.totals.rows / Math.max(data.totals.sessions, 1)).toFixed(1)} rows/session` : t.noData} />
            <MetricCard kicker={t.kickerTokens}   value={fmtNum(data.totals.tokens)}      sub={t.tokens} />
            <MetricCard kicker={t.kickerNodes}    value={fmtNum(data.totals.summaryNodes)} sub={data.totals.summaryNodes ? t.tabSummary : 'no compaction yet'} />
            <MetricCard kicker={t.kickerDb}       value={fmtBytes(data.totals.dbBytes)}   sub={`db + wal + shm`} />
          </div>

          {/* Profile selector */}
          {data.profiles.length > 0 ? (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Kicker>{t.kickerProfiles}</Kicker>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {data.profiles.map((p) => (
                    <Chip
                      key={p.profile}
                      active={p.profile === (active?.profile)}
                      onClick={() => setProfileSel(p.profile)}
                      icon={<Database size={11} />}
                    >
                      {p.profile} <span style={{ opacity: 0.6 }}>· {fmtNum(p.rows)}</span>
                    </Chip>
                  ))}
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
                  {t.generatedAt} {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </Card>
          ) : (
            <Card>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noProfiles}</div>
            </Card>
          )}

          {active && (active.rows > 0 ? <ProfilePanel p={active} t={t} lang={lang} /> : (
            <Card><div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noLcmRows}</div></Card>
          ))}

          {/* Config snapshot */}
          <SectionHead title={t.titleConfig} kicker="LCM_*" />
          <Card padding={0}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
                    <th style={thStyle}>{t.key}</th>
                    <th style={thStyle}>{t.value}</th>
                    <th style={thStyle}>{t.source2}</th>
                    <th style={thStyle}>{t.defaultVal}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.config.values).map(([k, v]) => (
                    <tr key={k} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={tdStyle}><code style={{ color: 'var(--accent)', fontSize: 11.5 }}>{k}</code></td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{v.value || <span style={{ color: 'var(--muted-2)' }}>—</span>}</td>
                      <td style={tdStyle}>
                        <Tag variant={v.source === 'env' ? 'green' : v.source === 'hermes-env' ? 'cyan' : 'default'} style={{ fontSize: 10 }}>
                          {v.source === 'env' ? t.env : v.source === 'hermes-env' ? t.hermesEnv : t.default_}
                        </Tag>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{v.default || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </Page>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--muted-2)',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 14px',
  color: 'var(--text)',
};

function ProfilePanel({
  p,
  t,
  lang,
}: {
  p: LcmProfileStats;
  t: Record<string, string>;
  lang: 'zh' | 'en';
}) {
  const roleEntries = Object.entries(p.byRole);
  const roleMax = Math.max(1, ...roleEntries.map(([, v]) => v));
  const sourceMax = Math.max(1, ...p.bySource.map((s) => s.rows));
  const depthEntries = Object.entries(p.summaryByDepth);
  const depthMax = Math.max(1, ...depthEntries.map(([, v]) => v));
  const hourMax = Math.max(...p.recentRowsByHour, 1);

  return (
    <>
      {/* Per-profile metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <MetricCard kicker={`${p.profile} · ${t.kickerRows}`} value={fmtNum(p.rows)}    sub={`${fmtNum(p.sessions)} sessions`} />
        <MetricCard kicker={t.kickerTokens}                    value={fmtNum(p.tokens)}  sub={`pinned ${fmtNum(p.pinned)}`} />
        <MetricCard kicker={t.kickerNodes}                     value={fmtNum(p.summaryNodes)} sub={`depth ${p.summaryMaxDepth}`} />
        <MetricCard kicker={t.dbSize}                          value={fmtBytes(p.dbBytes)} sub={`wal ${fmtBytes(p.walBytes)}`} />
      </div>

      {/* Activity sparkline */}
      <SectionHead title={t.titleHourly} kicker={<><Activity size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />24H</>} />
      <Card>
        {p.recentRowsByHour.some((v) => v > 0) ? (
          <>
            <Sparkline values={p.recentRowsByHour} height={64} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted-2)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
              <span>−24h</span><span>−18h</span><span>−12h</span><span>−6h</span><span>now</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
              {fmtNum(p.recentRowsByHour.reduce((a, b) => a + b, 0))} rows · peak {hourMax}/h
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noData}</div>
        )}
      </Card>

      {/* Two columns: roles + sources */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Card>
          <SectionHead title={t.titleRoleDist} kicker={t.role} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {roleEntries.length ? roleEntries.map(([role, count]) => (
              <BarRow key={role} label={role} value={count} max={roleMax} raw={fmtNum(count)} />
            )) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noData}</div>}
          </div>
        </Card>
        <Card>
          <SectionHead title={t.titleSourceDist} kicker={t.source} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {p.bySource.length ? p.bySource.map((s) => (
              <BarRow key={s.source} label={s.source} value={s.rows} max={sourceMax} raw={fmtNum(s.rows)} />
            )) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noData}</div>}
          </div>
        </Card>
      </div>

      {/* Top sessions */}
      <SectionHead title={t.titleTopSessions} kicker={<><Layers size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />SESSIONS</>} />
      <Card padding={0}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>{t.sessionId}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t.rows}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t.tokens}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t.lastAt}</th>
              </tr>
            </thead>
            <tbody>
              {p.topSessions.length ? p.topSessions.map((s) => (
                <tr key={s.sessionId} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{s.sessionId}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtNum(s.rows)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--muted)' }}>{fmtNum(s.tokens)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--muted)' }}>{relTimeFromEpoch(s.lastAt, lang)}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--muted)' }}>{t.noData}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* DAG + Lifecycle + Health row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Card>
          <SectionHead title={t.titleSummaryDepth} kicker={<><Sparkles size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />DAG</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {depthEntries.length ? depthEntries.map(([d, c]) => (
              <BarRow key={d} label={`${t.depth} ${d}`} value={c} max={depthMax} raw={fmtNum(c)} />
            )) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.noData} · {fmtNum(p.summaryNodes)} {t.nodes}</div>}
          </div>
        </Card>

        <Card>
          <SectionHead title={t.titleLifecycle} kicker={<><Cpu size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />STATE</>} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, columnGap: 12, fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)' }}>{t.lifecycleRows}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{fmtNum(p.lifecycle.rows)}</span>
            <span style={{ color: 'var(--muted)' }}>{t.totalDebt}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{fmtNum(p.lifecycle.totalDebt)}</span>
            <span style={{ color: 'var(--muted)' }}>{t.lastFinalized}</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{relTimeFromEpoch(p.lifecycle.lastFinalizedAt, lang)}</span>
            <span style={{ color: 'var(--muted)' }}>{t.lastRollover}</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{relTimeFromEpoch(p.lifecycle.lastRolloverAt, lang)}</span>
            <span style={{ color: 'var(--muted)' }}>{t.lastMaintenance}</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{relTimeFromEpoch(p.lifecycle.lastMaintenanceAt, lang)}</span>
          </div>
          {Object.keys(p.lifecycle.debtKinds).length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(p.lifecycle.debtKinds).map(([k, c]) => (
                <Tag key={k} variant={k === '(none)' || !k ? 'default' : 'yellow'}>
                  {k || '(none)'} · {c}
                </Tag>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHead title={t.titleHealth} kicker={<><HardDrive size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />SQLITE</>} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, columnGap: 12, fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)' }}>{t.journalMode}</span>
            <Tag variant={p.journalMode === 'wal' ? 'green' : 'default'} style={{ fontSize: 10 }}>{p.journalMode || '—'}</Tag>
            <span style={{ color: 'var(--muted)' }}>{t.quickCheck}</span>
            <Tag variant={p.quickCheck === 'ok' ? 'green' : p.quickCheck ? 'red' : 'default'} style={{ fontSize: 10 }}>{p.quickCheck || '—'}</Tag>
            <span style={{ color: 'var(--muted)' }}>{t.schemaVer}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{p.schemaVersion || '—'}</span>
            <span style={{ color: 'var(--muted)' }}>{t.dbSize}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtBytes(p.dbBytes)}</span>
            <span style={{ color: 'var(--muted)' }}>{t.walSize}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtBytes(p.walBytes)}</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.dbPath}
          </div>
        </Card>
      </div>

      {/* Largest rows */}
      {p.largestRows.length > 0 && (
        <>
          <SectionHead title={t.titleLargest} kicker={<><Hash size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />BYTES</>} />
          <Card padding={0}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
                  <th style={thStyle}>store_id</th>
                  <th style={thStyle}>session</th>
                  <th style={thStyle}>{t.role}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{t.bytes}</th>
                </tr>
              </thead>
              <tbody>
                {p.largestRows.map((r) => (
                  <tr key={`${r.storeId}`} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{r.storeId}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{r.sessionId}</td>
                    <td style={tdStyle}><Tag style={{ fontSize: 10 }}>{r.role}</Tag></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtBytes(r.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
