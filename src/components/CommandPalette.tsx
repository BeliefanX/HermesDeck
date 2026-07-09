'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Bot, CalendarClock, Cpu, FileCog, Home, MessageSquare, Search, Settings, Terminal, Wrench, ChevronRight,
} from 'lucide-react';
import type { DeckProfile, DeckSession, ToolSummary } from '@/lib/types';
import { deckApi } from '@/lib/api';
import { sourceMeta, shortTitle, relTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';
import { useDeckSession } from '@/lib/use-deck-session';

type CommandItem = {
  id: string;
  kind: 'page' | 'session' | 'profile' | 'tool' | 'action';
  title: string;
  hint?: string;
  href?: string;
  profileId?: string;
  search: string;
  icon: React.ReactNode;
};

export function CommandPalette() {
  const t = useT({
    zh: {
      paletteAria: '命令面板',
      searchAria: '搜索命令面板',
      searchPlaceholder: '搜索会话、配置、工具、页面…',
      loading: '加载中…',
      noMatches: '无匹配结果',
      footerNav: '↑↓ 导航',
      footerOpen: '↵ 打开',
      footerClose: 'esc 关闭',
      esc: 'esc',
      resultOne: '条结果',
      resultMany: '条结果',
      // page items
      pHome: '主页',           pHomeHint: '指挥台',
      pChat: '对话',           pChatHint: '新建会话',
      pModels: '模型配置',     pModelsHint: 'Dashboard · 只读',
      pConfig: 'Agent 配置',   pConfigHint: '配置文件 · SOUL · 记忆',
      pCron: '定时任务',       pCronHint: 'Scheduled Tasks',
      pTools: '工具',          pToolsHint: '能力注册表',
      pTerminal: '终端',       pTerminalHint: '安全运维控制台',
      pLcm: 'LCM',             pLcmHint: '上下文管理',
      pSettings: '设置',       pSettingsHint: '主题、偏好',
      // actions
      aNewChat: '新建对话',         aNewChatHint: '开启全新会话',
      // dynamic prefixes/suffixes
      profilePrefix: 'Agent',
      activeDot: '使用中 · ',
      sessionsSuffix: '个会话',
      disabled: '已停用',
    },
    en: {
      paletteAria: 'Command palette',
      searchAria: 'Search command palette',
      searchPlaceholder: 'Search sessions, Agents, tools, pages…',
      loading: 'Loading…',
      noMatches: 'No matches',
      footerNav: '↑↓ navigate',
      footerOpen: '↵ open',
      footerClose: 'esc close',
      esc: 'esc',
      resultOne: 'result',
      resultMany: 'results',
      pHome: 'Home',           pHomeHint: 'Command deck',
      pChat: 'Chat',           pChatHint: 'New conversation',
      pModels: 'Model Config', pModelsHint: 'Dashboard · read-only',
      pConfig: 'Agent Config', pConfigHint: 'Config files · SOUL · memory',
      pCron: 'Scheduled Tasks', pCronHint: 'Cron jobs',
      pTools: 'Tools',         pToolsHint: 'Capability registry',
      pTerminal: 'Terminal',   pTerminalHint: 'Safe ops console',
      pLcm: 'LCM',             pLcmHint: 'Context management',
      pSettings: 'Settings',   pSettingsHint: 'Theme, prefs',
      aNewChat: 'New chat',         aNewChatHint: 'Start a fresh session',
      profilePrefix: 'Agent',
      activeDot: 'active · ',
      sessionsSuffix: 'sessions',
      disabled: 'disabled',
    },
  });

  const PAGE_ITEMS: CommandItem[] = useMemo(() => [
    { id: 'p:home',    kind: 'page', title: t.pHome,     hint: t.pHomeHint,     href: '/',         search: 'home dashboard command deck',    icon: <Home size={14} /> },
    { id: 'p:chat',    kind: 'page', title: t.pChat,     hint: t.pChatHint,     href: '/chat',     search: 'chat new conversation message',  icon: <MessageSquare size={14} /> },
    { id: 'p:models',  kind: 'page', title: t.pModels,   hint: t.pModelsHint,   href: '/models',   search: 'models model configuration dashboard provider auxiliary delegation cron', icon: <Cpu size={14} /> },
    { id: 'p:config',  kind: 'page', title: t.pConfig,   hint: t.pConfigHint,   href: '/config',   search: 'config soul user memory yaml files', icon: <FileCog size={14} /> },
    { id: 'p:cron',    kind: 'page', title: t.pCron,     hint: t.pCronHint,     href: '/cron',     search: 'cron scheduled tasks jobs schedule', icon: <CalendarClock size={14} /> },
    { id: 'p:tools',   kind: 'page', title: t.pTools,    hint: t.pToolsHint,    href: '/tools',    search: 'tools skills mcp capabilities',  icon: <Wrench size={14} /> },
    { id: 'p:lcm',     kind: 'page', title: t.pLcm,      hint: t.pLcmHint,      href: '/lcm',      search: 'lcm context memory management', icon: <BookOpen size={14} /> },
    { id: 'p:terminal',kind: 'page', title: t.pTerminal, hint: t.pTerminalHint, href: '/terminal', search: 'terminal shell ops command',     icon: <Terminal size={14} /> },
    { id: 'p:settings',kind: 'page', title: t.pSettings, hint: t.pSettingsHint, href: '/settings', search: 'settings preferences theme',     icon: <Settings size={14} /> },
  ], [t]);

  const router = useRouter();
  const { activeProfile, setActiveProfile } = useActiveProfile();
  const { capabilities } = useDeckSession();
  const canUseTerminal = capabilities.canUseTerminal;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [sessions, setSessions] = useState<DeckSession[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Wall-clock of the last data load — drives a TTL refetch so the palette
  // doesn't show a stale snapshot for the whole page lifetime.
  const lastLoadRef = useRef(0);
  const lastProfileRef = useRef('');
  const loadSeqRef = useRef(0);

  // Open on ⌘K / Ctrl+K, or via the topbar button which dispatches a custom
  // `hermesdeck:open-palette` event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        // Open-only — a second ⌘K must not toggle the palette shut (it's easy
        // to mis-fire while typing). Esc / backdrop are the close affordances.
        setOpen(true);
        setQ('');
        setIdx(0);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onOpen = () => { setOpen(true); setQ(''); setIdx(0); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('hermesdeck:open-palette', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hermesdeck:open-palette', onOpen);
    };
  }, [open]);

  // Lazy-load on first open, then refetch on later opens once the snapshot is
  // older than the TTL — a new chat / failed run shouldn't stay invisible
  // until a full page reload.
  useEffect(() => {
    if (!open) return;
    if (loaded && lastProfileRef.current === activeProfile && Date.now() - lastLoadRef.current < 30_000) return;
    const profileForLoad = activeProfile;
    const seq = ++loadSeqRef.current;
    if (lastProfileRef.current !== profileForLoad) {
      setSessions([]);
    }
    Promise.allSettled([
      deckApi.profiles(), profileForLoad ? deckApi.sessions(profileForLoad) : Promise.resolve({ sessions: [] }), profileForLoad ? deckApi.tools(profileForLoad) : Promise.resolve({ tools: [] }),
    ]).then(([p, s, tl]) => {
      if (loadSeqRef.current !== seq) return;
      if (p.status === 'fulfilled') setProfiles(p.value.profiles);
      if (s.status === 'fulfilled') setSessions(s.value.sessions);
      if (tl.status === 'fulfilled') setTools(tl.value.tools);
      setLoaded(true);
      lastLoadRef.current = Date.now();
      lastProfileRef.current = profileForLoad;
    });
    return () => {
      if (loadSeqRef.current === seq) loadSeqRef.current += 1;
    };
  }, [open, loaded, activeProfile]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const allItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = PAGE_ITEMS.filter((item) => {
      if (item.id === 'p:terminal' && !canUseTerminal) return false;
      if (item.id === 'p:config' && !canUseTerminal) return false;
      if (item.id === 'p:lcm' && !canUseTerminal) return false;
      return true;
    });
    items.push({
      id: 'a:newchat', kind: 'action', title: t.aNewChat, hint: t.aNewChatHint,
      href: '/chat', search: 'new chat session start',
      icon: <MessageSquare size={14} />,
    });
    profiles.forEach((p) => items.push({
      id: `prof:${p.id}`, kind: 'profile', title: `${t.profilePrefix} · ${p.name}`,
      hint: `${p.active ? t.activeDot : ''}${p.sessionCount ?? 0} ${t.sessionsSuffix}${p.lastActiveAt ? ' · ' + relTime(p.lastActiveAt) : ''}`,
      profileId: p.id, href: '/chat', search: `profile ${p.id} ${p.name} ${p.model || ''}`,
      icon: <Bot size={14} />,
    }));
    sessions.slice(0, 50).forEach((s) => items.push({
      id: `sess:${s.id}`, kind: 'session', title: shortTitle(s.title, 60),
      hint: `${sourceMeta(s.source).short} · ${s.model || ''} · ${relTime(s.updatedAt || s.createdAt)}`,
      href: `/chat?session=${encodeURIComponent(s.id)}`,
      search: `session ${s.title} ${s.model || ''} ${s.source || ''}`,
      icon: <MessageSquare size={14} />,
    }));
    tools.slice(0, 100).forEach((tool) => items.push({
      id: `tool:${tool.kind}:${tool.name}`, kind: 'tool', title: tool.name,
      hint: `${tool.kind}${tool.source ? ' · ' + tool.source : ''}${tool.enabled === false ? ' · ' + t.disabled : ''}`,
      href: `/tools`, search: `tool ${tool.kind} ${tool.name} ${tool.category || ''}`,
      icon: <Wrench size={14} />,
    }));
    return items;
  }, [profiles, sessions, tools, PAGE_ITEMS, t, canUseTerminal]);

  // Defer the filter input so each keystroke doesn't block layout when the
  // candidate list is large (~200 items × tokenized substring scan).
  const deferredQ = useDeferredValue(q);
  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
    if (!needle) return allItems.slice(0, 25);
    const tokens = needle.split(/\s+/);
    const scored: Array<{ item: CommandItem; score: number }> = [];
    for (const it of allItems) {
      const hay = (it.title + ' ' + it.search).toLowerCase();
      const allMatch = tokens.every((tok) => hay.includes(tok));
      if (!allMatch) continue;
      // Title match boosts score; page kind boosts; recent sessions tie-breaker by their natural order
      let score = 0;
      if (it.title.toLowerCase().startsWith(needle)) score += 30;
      if (it.title.toLowerCase().includes(needle)) score += 12;
      if (it.kind === 'page') score += 8;
      scored.push({ item: it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((s) => s.item);
  }, [allItems, deferredQ]);

  useEffect(() => { setIdx(0); }, [q]);

  function activate(it: CommandItem) {
    setOpen(false);
    if (it.kind === 'profile' && it.profileId) setActiveProfile(it.profileId);
    if (it.href) router.push(it.href);
  }

  // Focus trap: cycle Tab between the input and the result rows so keyboard
  // users can't tab into elements visually obscured by the backdrop.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hasAttribute('disabled'));
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.paletteAria}
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'color-mix(in oklch, var(--strong-text) 18%, transparent)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '8vh 16px',
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-4)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '80vh',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <Search size={14} style={{ color: 'var(--muted-2)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchAria}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[idx]; if (it) activate(it); }
            }}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-sans)',
            }}
          />
          <span style={{ fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{t.esc}</span>
        </div>
        <div role="listbox" aria-label={t.paletteAria} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
              {!loaded ? t.loading : t.noMatches}
            </div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => activate(it)}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 14px',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                  background: i === idx ? 'var(--accent-soft)' : 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--line)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent)',
                }}>{it.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.title}
                  </div>
                  {it.hint && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.hint}
                    </div>
                  )}
                </div>
                <ChevronRight size={12} style={{ color: 'var(--muted-2)' }} />
              </button>
            ))
          )}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--hairline)', display: 'flex', gap: 12, fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
          <span>{t.footerNav}</span><span>{t.footerOpen}</span><span>{t.footerClose}</span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length} {filtered.length === 1 ? t.resultOne : t.resultMany}</span>
        </div>
      </div>
    </div>
  );
}
