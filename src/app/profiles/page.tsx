'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckModelsResponse, DeckProfile, ModelInfo, ProviderInfo } from '@/lib/types';
import {
  Activity, AlertCircle, Bot, Check, ChevronDown, CircleDot, Cpu, Database,
  KeyRound, PauseCircle, Power, Server, Sparkles, Star, Pin,
} from 'lucide-react';
import { Card, Kbd, Kicker, MetricCard, Page, SectionHead, Tag, Btn, type Tone } from '@/components/Brand';
import { relTime, useNowTick } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';
import { NoAssignedAgentsState } from '@/components/NoAssignedAgentsState';

function fmtTokens(n?: number): string {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export default function ProfilesPage() {
  const t = useT({
    zh: {
      introA: 'Profile 是 HermesDeck 的智能体与执行上下文单元。每一个都拥有独立的状态目录 ',
      introB: '。在下方选择一个 profile，即可查看它实际使用过的服务商与模型。',
      kickerProfiles: '执行上下文',
      titleProfiles: 'Profiles',
      kickerRouting: '路由 · 已用模型',
      titleRouting: '路由与模型',
      activeProfile: '当前激活 profile',
      modelsHint: '此处只展示该 profile 实际使用过的服务商与模型。配置中的默认项会被高亮；仅存在于配置目录、从未被调用的条目会被隐藏。',
      kickerProvidersUsed: '服务商 · 已使用',
      kickerModelsUsed: '模型 · 该 PROFILE 已用',
      kickerTokensAll: 'TOKENS · 累计',
      loading: '加载中…',
      withCreds: '个已配置凭证',
      hiddenCatalog: '已隐藏：仅在配置目录中存在的条目',
      acrossPxM: '跨服务商 × 模型聚合',
      kickerDefault: '默认模型',
      currentlyActive: '当前生效',
      provider: '服务商 · ',
      baseUrl: 'base_url · ',
      loadFailed: '加载失败：',
      noProfiles: '未找到任何 profile',
      noProfilesDesc1: 'HermesDeck 将以默认上下文运行。使用 ',
      noProfilesDesc2: ' 添加新的执行上下文。',
      noModelUsage: '尚无模型使用记录',
      noModelUsageDesc: '该 profile 还没有任何会话记录。开启一次聊天，即可在此查看服务商与模型的使用拆分。',
      runtimeRunning: '运行中',
      runtimeStarting: '启动中',
      runtimeStopped: '已停止',
      runtimeFailed: '已失败',
      runtimeUnknown: '未知',
      ariaSelectProfile: '选择 profile',
      modelFromConfig: '使用 Hermes 配置中的模型',
      sessionsSuffix: ' 次会话',
      lastActive: '上次活跃 ',
      noActivityYet: '尚未活跃',
      noActivity: '尚未活跃',
      active: '已激活',
      defaultTag: '默认',
      kickerSessions: '会话',
      kickerTokens: 'TOKENS',
      kickerBaseUrl: 'BASE_URL',
      credsSuffix: ' 个凭证',
      usedSuffix: ' 个已用',
      noProviderUsage: '该服务商下尚无模型使用记录。',
      modelSessions: ' 次会话',
      authFailed: '认证失败',
      setActive: '设为当前 Agent',
      currentAgent: '当前 Agent',
    },
    en: {
      introA: 'A profile is HermesDeck’s agent & execution-context unit. Each one keeps its own state directory at ',
      introB: '. Pick a profile below to see which providers and models it has actually used.',
      kickerProfiles: 'EXECUTION CONTEXTS',
      titleProfiles: 'Profiles',
      kickerRouting: 'ROUTING · USED MODELS',
      titleRouting: 'Routing & models',
      activeProfile: 'active profile',
      modelsHint: 'Showing only providers and models that this profile has actually used. The configured default is highlighted; catalog-only entries (configured but never invoked) are hidden.',
      kickerProvidersUsed: 'PROVIDERS · USED',
      kickerModelsUsed: 'MODELS · USED IN PROFILE',
      kickerTokensAll: 'TOKENS · ALL TIME',
      loading: 'Loading…',
      withCreds: ' with credentials',
      hiddenCatalog: 'hidden: catalog-only entries',
      acrossPxM: 'across providers × models',
      kickerDefault: 'DEFAULT MODEL',
      currentlyActive: 'currently active',
      provider: 'provider · ',
      baseUrl: 'base_url · ',
      loadFailed: 'Load failed:',
      noProfiles: 'No profiles found',
      noProfilesDesc1: 'HermesDeck will run with a default context. Use ',
      noProfilesDesc2: ' to add a new execution context.',
      noModelUsage: 'No model usage yet',
      noModelUsageDesc: 'This profile hasn’t recorded any sessions yet. Start a chat to see provider and model breakdowns here.',
      runtimeRunning: 'Running',
      runtimeStarting: 'Starting',
      runtimeStopped: 'Stopped',
      runtimeFailed: 'Failed',
      runtimeUnknown: 'Unknown',
      ariaSelectProfile: 'Select profile',
      modelFromConfig: 'model from Hermes config',
      sessionsSuffix: ' sessions',
      lastActive: 'last active ',
      noActivityYet: 'no activity yet',
      noActivity: 'no activity',
      active: 'active',
      defaultTag: 'default',
      kickerSessions: 'SESSIONS',
      kickerTokens: 'TOKENS',
      kickerBaseUrl: 'BASE_URL',
      credsSuffix: ' creds',
      usedSuffix: ' used',
      noProviderUsage: 'No model usage recorded under this provider yet.',
      modelSessions: ' sessions',
      authFailed: 'auth failed',
      setActive: 'Set as active agent',
      currentAgent: 'Current agent',
    },
  });

  // Profile list & active selection both come from ProfileContext now. The
  // page's local "selectedId" is kept (so the user can browse without changing
  // the global active), but it defaults to whatever the context says is active.
  const { profiles, loading: loadingProfiles, activeProfile, setActiveProfile, hydrated } = useActiveProfile();
  const [selectedId, setSelectedId] = useState<string>('');
  // Keep "last active 5m ago" labels live — this page fetches once.
  useNowTick();

  const [models, setModels] = useState<DeckModelsResponse | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsErr, setModelsErr] = useState<string>('');

  // Default the inspection target to the global active profile once the
  // context has hydrated. After that, let the user pick freely.
  useEffect(() => {
    if (!hydrated) return;
    if (selectedId) return;
    if (profiles.length === 0) return;
    const fallback = profiles.find((p) => p.id === activeProfile)?.id
      || profiles.find((p) => p.active)?.id
      || profiles[0]?.id
      || 'default';
    setSelectedId(fallback);
  }, [hydrated, profiles, activeProfile, selectedId]);

  // Re-fetch the models section whenever the selected profile changes — each
  // profile keeps its own state.db, so usage / providers can differ.
  useEffect(() => {
    if (!selectedId) return;
    const ac = new AbortController();
    setLoadingModels(true);
    setModelsErr('');
    deckApi.models(selectedId, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setModels(r); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setModelsErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!ac.signal.aborted) setLoadingModels(false); });
    return () => { ac.abort(); };
  }, [selectedId]);

  // The page only renders providers/models that have actually recorded usage.
  // Catalog-only entries get dropped — they confuse the eye without adding
  // signal here (the user has to dig past unused models to see the ones they
  // actually run).
  const usedProviders = useMemo(() => {
    if (!models) return [] as ProviderInfo[];
    return models.providers
      .map((p) => ({ ...p, models: p.models.filter((mm) => mm.used) }))
      .filter((p) => p.models.length > 0);
  }, [models]);

  const totals = useMemo(() => {
    let m = 0; let tt = 0; let withCreds = 0;
    for (const p of usedProviders) {
      m += p.models.length;
      tt += p.models.reduce((s, mm) => s + (mm.tokens || 0), 0);
      if ((p.credentialCount || 0) > 0) withCreds += 1;
    }
    return { providers: usedProviders.length, models: m, tokens: tt, withCreds };
  }, [usedProviders]);

  const selected = profiles.find((p) => p.id === selectedId);

  return (
    <Page
      intro={
        <>
          {t.introA}<Kbd>~/.hermes/profiles/&lt;id&gt;</Kbd>{t.introB}
        </>
      }
    >
      <SectionHead
        kicker={t.kickerProfiles}
        title={
          <>
            <Bot size={15} style={{ color: 'var(--accent)' }} />
            <span>{t.titleProfiles}</span>
            {!loadingProfiles && <Tag>{profiles.length}</Tag>}
          </>
        }
      />

      <div style={{ marginTop: -10, marginBottom: 18 }}>
        {loadingProfiles ? (
          <Card>
            <div className="skel" style={{ width: 220, height: 18 }} />
            <div style={{ height: 8 }} />
            <div className="skel" style={{ width: 280, height: 12 }} />
          </Card>
        ) : profiles.length === 0 ? (
          <NoAssignedAgentsState />
        ) : (
          <ProfileSelector
            profiles={profiles}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>

      {/* ── Models section ───────────────────────────────────────── */}
      <SectionHead
        kicker={t.kickerRouting}
        title={
          <>
            <Cpu size={15} style={{ color: 'var(--accent)' }} />
            <span>{t.titleRouting}</span>
            {selected && <Kbd>{selected.id}</Kbd>}
          </>
        }
        right={
          selected ? (
            selected.id === activeProfile ? (
              <Tag variant="green" icon={<Sparkles size={11} />}>{t.currentAgent}</Tag>
            ) : (
              <Btn
                size="sm"
                variant="primary"
                icon={<Pin size={11} />}
                onClick={() => setActiveProfile(selected.id)}
              >
                {t.setActive}
              </Btn>
            )
          ) : null
        }
      />
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: -6 }}>
        {t.modelsHint}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker={t.kickerProvidersUsed}
          value={loadingModels || !models ? '—' : totals.providers}
          sub={loadingModels ? t.loading : `${totals.withCreds}${t.withCreds}`}
        />
        <MetricCard
          kicker={t.kickerModelsUsed}
          value={loadingModels || !models ? '—' : totals.models}
          sub={t.hiddenCatalog}
        />
        <MetricCard
          kicker={t.kickerTokensAll}
          value={loadingModels || !models ? '—' : fmtTokens(totals.tokens)}
          sub={t.acrossPxM}
        />
      </div>

      {models?.default && (
        <Card hero>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Kicker>{t.kickerDefault}</Kicker>
              <h2
                style={{
                  margin: '6px 0 6px',
                  fontSize: 20,
                  fontWeight: 650,
                  letterSpacing: '-.018em',
                  color: 'var(--strong-text)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Star size={16} style={{ color: 'var(--accent)' }} />
                {models.default.model}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{t.provider}<Kbd>{models.default.provider}</Kbd></span>
                {models.default.baseUrl && <span>{t.baseUrl}<Kbd>{models.default.baseUrl}</Kbd></span>}
              </div>
            </div>
            <Tag variant="green" icon={<Sparkles size={11} />}>{t.currentlyActive}</Tag>
          </div>
        </Card>
      )}

      {modelsErr && (
        <Card style={{ borderColor: 'rgba(239,68,68,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
            <AlertCircle size={15} /> {t.loadFailed} {modelsErr}
          </div>
        </Card>
      )}

      {loadingModels && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <div className="skel" style={{ width: 180, height: 22 }} />
              <div style={{ height: 8 }} />
              <div className="skel" style={{ width: 240, height: 12 }} />
              <div style={{ height: 16 }} />
              <div className="skel" style={{ width: '100%', height: 60 }} />
            </Card>
          ))}
        </div>
      )}

      {!loadingModels && usedProviders.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}

      {!loadingModels && models && usedProviders.length === 0 && (
        <Card style={{ textAlign: 'center', padding: 28 }}>
          <Cpu size={22} style={{ color: 'var(--muted)' }} />
          <h2 style={{ margin: '8px 0 4px', fontSize: 16, fontWeight: 620, color: 'var(--strong-text)' }}>
            {t.noModelUsage}
          </h2>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
            {t.noModelUsageDesc}
          </p>
        </Card>
      )}
    </Page>
  );
}

// Map Hermes' gateway field (running / stopped / starting / unknown / —) onto
// a deck Tag tone + icon + readable label. Defensive against unexpected values
// so a future Hermes state never crashes the card.
function useProfileRuntime() {
  const t = useT({
    zh: {
      running: '运行中',
      starting: '启动中',
      stopped: '已停止',
      failed: '已失败',
      unknown: '未知',
    },
    en: {
      running: 'Running',
      starting: 'Starting',
      stopped: 'Stopped',
      failed: 'Failed',
      unknown: 'Unknown',
    },
  });
  return (state?: string): { tone: Tone; label: string; icon: React.ReactNode } => {
    const s = (state || '').trim().toLowerCase();
    if (s === 'running' || s === 'up' || s === 'online') {
      return { tone: 'green', label: t.running, icon: <CircleDot size={11} /> };
    }
    if (s === 'starting' || s === 'pending' || s === 'booting') {
      return { tone: 'yellow', label: t.starting, icon: <Activity size={11} /> };
    }
    if (s === 'stopped' || s === 'down' || s === 'offline') {
      return { tone: 'default', label: t.stopped, icon: <PauseCircle size={11} /> };
    }
    if (s === 'failed' || s === 'error' || s === 'crashed') {
      return { tone: 'red', label: t.failed, icon: <AlertCircle size={11} /> };
    }
    // Any value Hermes returns that isn't in the known set: show a single
    // "Unknown" label rather than rendering a raw gateway token as a status.
    return { tone: 'default', label: t.unknown, icon: <Power size={11} /> };
  };
}

function ProfileSelector({
  profiles,
  selectedId,
  onSelect,
}: {
  profiles: DeckProfile[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const t = useT({
    zh: {
      modelFromConfig: '使用 Hermes 配置中的模型',
      sessionsSuffix: ' 次会话',
      lastActive: '上次活跃 ',
      noActivityYet: '尚未活跃',
      noActivity: '尚未活跃',
      active: '已激活',
      ariaSelectProfile: '选择 profile',
    },
    en: {
      modelFromConfig: 'model from Hermes config',
      sessionsSuffix: ' sessions',
      lastActive: 'last active ',
      noActivityYet: 'no activity yet',
      noActivity: 'no activity',
      active: 'active',
      ariaSelectProfile: 'Select profile',
    },
  });
  const profileRuntime = useProfileRuntime();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = profiles.find((p) => p.id === selectedId) || profiles[0];
  const runtime = profileRuntime(selected?.gateway);

  // Close on outside click / Escape so the menu doesn't trap the user when
  // they click into the models section below.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!selected) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 18px',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
          fontFamily: 'inherit',
          transition: 'border-color 200ms cubic-bezier(.2,.7,.2,1)',
          borderColor: open ? 'var(--accent-border)' : 'var(--line)',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: 'var(--surface-bg)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            flexShrink: 0,
          }}
        >
          <Bot size={18} />
        </span>
        <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 650,
                letterSpacing: '-.012em',
                color: 'var(--strong-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {selected.name}
            </span>
            <Kbd>{selected.id}</Kbd>
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {selected.model || t.modelFromConfig} ·{' '}
            {(selected.sessionCount ?? 0).toLocaleString()}{t.sessionsSuffix} ·{' '}
            {selected.lastActiveAt ? `${t.lastActive}${relTime(selected.lastActiveAt)}` : t.noActivityYet}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <Tag variant={runtime.tone} icon={runtime.icon}>{runtime.label}</Tag>
          {selected.active && <Tag variant="green">{t.active}</Tag>}
          <ChevronDown
            size={14}
            style={{
              color: 'var(--muted)',
              transition: 'transform 200ms cubic-bezier(.2,.7,.2,1)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t.ariaSelectProfile}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 30,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-pop)',
            overflow: 'hidden',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {profiles.map((p) => {
            const r = profileRuntime(p.gateway);
            const isSelected = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: isSelected ? 'var(--accent-soft)' : 'transparent',
                  border: 'none',
                  borderTop: '1px solid var(--hairline)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  {isSelected ? <Check size={13} style={{ color: 'var(--accent)' }} /> : null}
                </span>
                <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--strong-text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
                      {p.id}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.model || '—'} · {(p.sessionCount ?? 0).toLocaleString()}{t.sessionsSuffix} ·{' '}
                    {p.lastActiveAt ? relTime(p.lastActiveAt) : t.noActivity}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <Tag variant={r.tone} icon={r.icon}>{r.label}</Tag>
                  {p.active && <Tag variant="green">{t.active}</Tag>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const t = useT({
    zh: {
      defaultTag: '默认',
      authFailed: '认证失败',
      credsSuffix: ' 个凭证',
      usedSuffix: ' 个已用',
      kickerSessions: '会话',
      kickerTokens: 'TOKENS',
      kickerBaseUrl: 'BASE_URL',
      noUsage: '该服务商下尚无模型使用记录。',
    },
    en: {
      defaultTag: 'default',
      authFailed: 'auth failed',
      credsSuffix: ' creds',
      usedSuffix: ' used',
      kickerSessions: 'SESSIONS',
      kickerTokens: 'TOKENS',
      kickerBaseUrl: 'BASE_URL',
      noUsage: 'No model usage recorded under this provider yet.',
    },
  });
  const totalTokens = provider.models.reduce((s, m) => s + (m.tokens || 0), 0);
  const totalSessions = provider.models.reduce((s, m) => s + (m.sessions || 0), 0);
  const maxTokens = Math.max(...provider.models.map((m) => m.tokens || 0), 1);
  const usedCount = provider.models.length;

  return (
    <Card>
      <SectionHead
        kicker={provider.id}
        title={
          <>
            <Server size={15} style={{ color: 'var(--accent)' }} />
            <span>{provider.name}</span>
            {provider.isDefault && <Tag variant="green" icon={<Star size={10} />}>{t.defaultTag}</Tag>}
            {provider.authFailed && <Tag variant="red" icon={<AlertCircle size={10} />}>{t.authFailed}</Tag>}
          </>
        }
        right={
          <>
            {provider.credentialCount != null && (
              <Tag icon={<KeyRound size={11} />}>{provider.credentialCount}{t.credsSuffix}</Tag>
            )}
            <Tag icon={<Cpu size={11} />}>{usedCount}{t.usedSuffix}</Tag>
          </>
        }
      />

      <div
        style={{
          display: 'flex',
          gap: 24,
          padding: '10px 0',
          borderTop: '1px solid var(--hairline)',
          borderBottom: '1px solid var(--hairline)',
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Kicker>{t.kickerSessions}</Kicker>
          <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {totalSessions.toLocaleString()}
          </div>
        </div>
        <div>
          <Kicker>{t.kickerTokens}</Kicker>
          <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtTokens(totalTokens)}
          </div>
        </div>
        {provider.baseUrl && (
          <div style={{ flex: 1, minWidth: 180 }}>
            <Kicker>{t.kickerBaseUrl}</Kicker>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--value-text)', wordBreak: 'break-all', marginTop: 4 }}>
              {provider.baseUrl}
            </div>
          </div>
        )}
      </div>

      <div>
        {provider.models.map((m, i) => (
          <ModelRow key={m.id} model={m} maxTokens={maxTokens} first={i === 0} />
        ))}
        {provider.models.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 4px' }}>
            <Database size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {t.noUsage}
          </div>
        )}
      </div>
    </Card>
  );
}

function ModelRow({ model, maxTokens, first }: { model: ModelInfo; maxTokens: number; first?: boolean }) {
  const t = useT({
    zh: { sessionsSuffix: ' 次会话' },
    en: { sessionsSuffix: ' sessions' },
  });
  const pct = maxTokens > 0 ? ((model.tokens || 0) / maxTokens) * 100 : 0;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 2fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '8px 0',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Cpu
          size={12}
          style={{ color: model.isDefault ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: model.isDefault ? 600 : 500,
            color: model.isDefault ? 'var(--accent)' : 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {model.id}
        </span>
        {model.isDefault && <Star size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
      </div>
      <div style={{ height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          justifyContent: 'flex-end',
        }}
      >
        <span style={{ color: 'var(--value-text)' }}>{fmtTokens(model.tokens)}</span>
        <span style={{ color: 'var(--muted-2)' }}>{model.sessions || 0}{t.sessionsSuffix}</span>
        <span style={{ color: 'var(--muted-2)' }}>{relTime(model.lastUsed)}</span>
      </div>
    </div>
  );
}
