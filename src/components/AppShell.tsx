'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  BookOpen, Bot, FileCog, Globe, Home, KanbanSquare, Menu, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen,
  Radio, Search, Settings, Sun, Terminal, Wrench, X,
} from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { BrandMark } from './BrandMark';
import { ProfileChip } from './ProfileChip';
import { deckApi } from '@/lib/api';
import type { HealthStatus } from '@/lib/types';
import { useT, useLang, toggleLang } from '@/lib/i18n';
import { useDeckSession } from '@/lib/use-deck-session';

const SIDEBAR_KEY = 'hermesdeck-sidebar-collapsed';

type IconType = ComponentType<{ size?: number | string; className?: string }>;
type NavKey = 'home' | 'chat' | 'profiles' | 'config' | 'runs' | 'kanban' | 'tools' | 'lcm' | 'terminal' | 'settings';
type NavItem = { href: string; key: NavKey; icon: IconType };

const NAV: NavItem[] = [
  { href: '/',         key: 'home',     icon: Home },
  { href: '/chat',     key: 'chat',     icon: MessageSquare },
  { href: '/profiles', key: 'profiles', icon: Bot },
  { href: '/config',   key: 'config',   icon: FileCog },
  { href: '/runs',     key: 'runs',     icon: Radio },
  { href: '/kanban',   key: 'kanban',   icon: KanbanSquare },
  { href: '/tools',    key: 'tools',    icon: Wrench },
  { href: '/lcm',      key: 'lcm',      icon: BookOpen },
  { href: '/terminal', key: 'terminal', icon: Terminal },
  { href: '/settings', key: 'settings', icon: Settings },
];

const MOBILE_PRIMARY: ReadonlySet<string> = new Set(['/', '/chat', '/profiles', '/terminal']);

// Routes that don't read the active profile — hide the switcher there to avoid
// implying a selection has any effect on the page.
const PROFILE_CHIP_HIDDEN: ReadonlySet<string> = new Set(['/tools', '/settings', '/terminal']);

function isRouteActive(path: string, href: string) {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  // Auth routes render full-bleed without sidebar/topbar chrome.
  const bare = path === '/login' || path === '/register' || path === '/pending';
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [apiStatus, setApiStatus] = useState<HealthStatus | 'checking'>('checking');
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const lang = useLang();
  const { capabilities } = useDeckSession();
  const canUseTerminal = capabilities.canUseTerminal;
  const canManageUsers = capabilities.canManageUsers;

  // Reflect real Hermes API health in the sidebar footer dot — previously it
  // was hardcoded green, which contradicted the dashboard hero whenever Hermes
  // was actually down or degraded.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      deckApi.health()
        .then((h) => { if (alive) setApiStatus(h.status); })
        .catch(() => { if (alive) setApiStatus('unreachable'); });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const t = useT({
    zh: {
      navHome:     { label: '主页',     kicker: '指挥台' },
      navChat:     { label: '对话',     kicker: '会话列表' },
      navProfiles: { label: '配置',     kicker: '配置 · 模型' },
      navConfig:   { label: 'Agent 配置', kicker: 'SOUL · 记忆 · YAML' },
      navRuns:     { label: '运行',     kicker: '运行时间线' },
      navKanban:   { label: '看板',     kicker: '多 Agent 任务' },
      navTools:    { label: '工具',     kicker: '工具集 · MCP' },
      navLcm:      { label: 'LCM',      kicker: '上下文管理' },
      navTerminal: { label: '终端',     kicker: '安全运维控制台' },
      navSettings: { label: '设置',     kicker: '偏好设置' },
      brandSubtitle: '控制台 · v1',
      apiOnline: '在线',
      apiDegraded: '降级',
      apiOffline: '离线',
      apiChecking: '检测中',
      apiLabel: 'API',
      footerHint: '配置、运行与工具事件均为一等公民。',
      expandSidebar: '展开侧栏',
      collapseSidebar: '收起侧栏',
      primaryNav: '主导航',
      pages: '页面',
      mobileNav: '移动端导航',
      moreNav: '更多',
      moreSheetLabel: '更多导航',
      close: '关闭',
      searchPlaceholder: '搜索会话、配置、工具、运行……',
      cmdPaletteAriaLabel: '打开命令面板',
      cmdPaletteTitle: '打开命令面板（⌘K）',
      lightMode: '切换到浅色模式',
      darkMode: '切换到深色模式',
      langSwitchTitle: '切换到 English',
      langSwitchAria: '切换到英文',
    },
    en: {
      navHome:     { label: 'Home',     kicker: 'COMMAND DECK' },
      navChat:     { label: 'Chat',     kicker: 'CONVERSATIONS' },
      navProfiles: { label: 'Profiles', kicker: 'PROFILES · MODELS' },
      navConfig:   { label: 'Agent Config', kicker: 'SOUL · MEMORY · YAML' },
      navRuns:     { label: 'Runs',     kicker: 'RUN TIMELINE' },
      navKanban:   { label: 'Kanban',   kicker: 'MULTI-AGENT BOARD' },
      navTools:    { label: 'Tools',    kicker: 'TOOLSETS · MCP' },
      navLcm:      { label: 'LCM',      kicker: 'LOSSLESS CONTEXT' },
      navTerminal: { label: 'Terminal', kicker: 'SAFE OPS CONSOLE' },
      navSettings: { label: 'Settings', kicker: 'SETTINGS' },
      brandSubtitle: 'CONTROL · v1',
      apiOnline: 'online',
      apiDegraded: 'degraded',
      apiOffline: 'offline',
      apiChecking: 'checking…',
      apiLabel: 'API',
      footerHint: 'Profiles, runs and tool events are first-class.',
      expandSidebar: 'Expand sidebar',
      collapseSidebar: 'Collapse sidebar',
      primaryNav: 'Primary navigation',
      pages: 'Pages',
      mobileNav: 'Mobile navigation',
      moreNav: 'More',
      moreSheetLabel: 'More navigation',
      close: 'Close',
      searchPlaceholder: 'Search sessions, profiles, tools, runs…',
      cmdPaletteAriaLabel: 'Open command palette',
      cmdPaletteTitle: 'Open command palette (⌘K)',
      lightMode: 'Switch to light mode',
      darkMode: 'Switch to dark mode',
      langSwitchTitle: 'Switch to 中文',
      langSwitchAria: 'Switch to Chinese',
    },
  });

  // Build the localised nav once per language change rather than on every render.
  const navItems = useMemo(
    () => NAV.filter((n) => {
      if (n.key === 'terminal' && !canUseTerminal) return false;
      if (n.key === 'config' && !canManageUsers) return false;
      if (n.key === 'lcm' && !canManageUsers) return false;
      return true;
    }).map((n) => ({
      ...n,
      label: t[`nav${n.key.charAt(0).toUpperCase() + n.key.slice(1)}` as keyof typeof t] as { label: string; kicker: string },
    })),
    [t, canUseTerminal, canManageUsers],
  );

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as 'dark' | 'light') || 'dark';
    setTheme(current);
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === '1') setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  // iOS PWA keyboard handling: when the OS keyboard slides up, position:fixed
  // elements stay in the *layout viewport* and end up hidden behind it. We
  // measure the gap via the visualViewport API and expose it as `--kb-inset`
  // on <html>, which the chat composer / mobile-nav CSS can subtract from
  // their `bottom` offset so they stay glued to the keyboard's top edge.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      root.style.removeProperty('--kb-inset');
    };
  }, []);

  const closeMoreSheet = useCallback((restoreFocus = true) => {
    setMoreOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => restoreFocusRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => { closeMoreSheet(false); }, [path, closeMoreSheet]);

  useEffect(() => {
    if (!moreOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocusRef.current = previouslyFocused;
    window.setTimeout(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMoreSheet(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen, closeMoreSheet]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hermesdeck-theme', next); } catch {}
  }

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  const active = navItems.find((n) => isRouteActive(path, n.href)) || navItems[0];
  const ActiveIcon = active.icon;
  const mobilePrimary = navItems.filter((n) => MOBILE_PRIMARY.has(n.href));
  const mobileOverflow = navItems.filter((n) => !MOBILE_PRIMARY.has(n.href));

  // The chat page goes full-bleed on mobile and merges its own header with the
  // global app-bar. Tagging the root lets CSS hide redundant chrome there.
  const routeKey = path === '/chat' ? 'chat' : (path.split('/')[1] || 'home');
  const showProfileChip = !Array.from(PROFILE_CHIP_HIDDEN).some((href) => isRouteActive(path, href));

  const apiDot =
    apiStatus === 'connected' ? 'var(--green)' :
    apiStatus === 'degraded' ? 'var(--yellow)' :
    apiStatus === 'unreachable' ? 'var(--red)' :
    'var(--muted-2)';
  const apiRing =
    apiStatus === 'connected' ? 'rgba(34,197,94,.18)' :
    apiStatus === 'degraded' ? 'rgba(234,179,8,.18)' :
    apiStatus === 'unreachable' ? 'rgba(239,68,68,.18)' :
    'rgba(150,150,160,.16)';
  const apiStatusLabel =
    apiStatus === 'connected' ? t.apiOnline :
    apiStatus === 'degraded' ? t.apiDegraded :
    apiStatus === 'unreachable' ? t.apiOffline :
    t.apiChecking;

  if (bare) return <>{children}</>;

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`} data-route={routeKey}>
      {/* Desktop sidebar */}
      <aside className="sidebar" aria-label={t.primaryNav}>
        <div className="brand" style={{ alignItems: 'center' }}>
          <div className="brand-badge" aria-hidden>
            <BrandMark className="brand-mark" width={32} height={32} />
          </div>
          {!collapsed && (
            <div className="brand-text">
              <div className="brand-title">HermesDeck</div>
              <div className="brand-subtitle">{t.brandSubtitle}</div>
            </div>
          )}
        </div>

        <nav className="nav" aria-label={t.pages}>
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = isRouteActive(path, href);
            return (
              <Link
                key={href}
                href={href}
                className={isActive ? 'active' : ''}
                aria-label={label.label}
                title={collapsed ? label.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 34,
                  padding: collapsed ? 0 : '0 8px 0 10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: isActive ? 550 : 400,
                  color: isActive ? 'var(--strong-text)' : 'var(--nav-text)',
                  background: isActive ? 'rgba(56,189,248,.12)' : 'transparent',
                  borderLeft: `2px solid ${isActive ? 'rgba(56,189,248,.55)' : 'transparent'}`,
                  paddingLeft: collapsed ? 0 : 10,
                  textDecoration: 'none',
                  transition: 'background 200ms cubic-bezier(.2,.7,.2,1), color 200ms',
                }}
              >
                <Icon size={14} className={isActive ? 'icon-active' : ''} />
                <span className="nav-label">{label.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          {!collapsed && (
            <div className="sidebar-footer">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: apiDot, boxShadow: `0 0 0 3px ${apiRing}`,
                }} />
                <span className="value" style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}>{t.apiLabel}</span>
                <span className="tiny" style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{apiStatusLabel}</span>
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {t.footerHint}
              </div>
            </div>
          )}
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
            title={collapsed ? t.expandSidebar : t.collapseSidebar}
            suppressHydrationWarning
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <main className="main">
        {/* Desktop topbar */}
        <div className="topbar" role="banner">
          <div className="topbar-left">
            <ActiveIcon size={15} className="topbar-active-icon" />
            <div className="topbar-title topbar-title-row">
              <h1>{active.label.label}</h1>
              {showProfileChip && <ProfileChip />}
            </div>
          </div>
          <div className="topbar-meta" style={{ flex: 1, justifyContent: 'flex-end', maxWidth: '100%' }}>
            <div id="topbar-page-slot" style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
            <button
              type="button"
              className="topbar-search"
              aria-label={t.cmdPaletteAriaLabel}
              title={t.cmdPaletteTitle}
              onClick={() => {
                // Single source of truth — CommandPalette listens for this event.
                window.dispatchEvent(new CustomEvent('hermesdeck:open-palette'));
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 32,
                padding: '0 12px',
                flex: 1,
                minWidth: 0,
                maxWidth: 360,
                background: 'var(--bg-soft)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                color: 'var(--text)',
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Search size={13} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
              <span style={{
                fontSize: 12.5,
                color: 'var(--muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}>{t.searchPlaceholder}</span>
              <span className="kbd" style={{ marginLeft: 'auto', flexShrink: 0 }}>⌘K</span>
            </button>
            <button
              className="btn icon ghost"
              onClick={toggleLang}
              aria-label={t.langSwitchAria}
              title={t.langSwitchTitle}
              suppressHydrationWarning
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            >
              <Globe size={14} />
              <span>{lang === 'zh' ? 'EN' : '中'}</span>
            </button>
            <button
              className="btn icon ghost"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t.lightMode : t.darkMode}
              suppressHydrationWarning
            >
              {mounted ? (theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />) : <Moon size={15} />}
            </button>
          </div>
        </div>

        {/* Mobile app bar */}
        <header className="app-bar" role="banner">
          <div className="ab-brand">
            <div className="brand-badge" aria-hidden>
              <BrandMark className="brand-mark" width={32} height={32} />
            </div>
            <div className="ab-title-row">
              <div className="ab-title">{active.label.label}</div>
              {showProfileChip && <ProfileChip />}
            </div>
          </div>
          <div className="ab-actions">
            <button
              className="btn icon"
              onClick={() => window.dispatchEvent(new CustomEvent('hermesdeck:open-palette'))}
              aria-label={t.cmdPaletteAriaLabel}
              title={t.cmdPaletteTitle}
            >
              <Search size={15} />
            </button>
            <button
              className="btn icon"
              onClick={toggleLang}
              aria-label={t.langSwitchAria}
              title={t.langSwitchTitle}
              suppressHydrationWarning
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            >
              <Globe size={14} />
              <span>{lang === 'zh' ? 'EN' : '中'}</span>
            </button>
            <button
              className="btn icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t.lightMode : t.darkMode}
              suppressHydrationWarning
            >
              {mounted ? (theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />) : <Moon size={15} />}
            </button>
          </div>
        </header>

        {children}
      </main>

      {/* Command palette (⌘K / Ctrl+K) */}
      <CommandPalette />

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" aria-label={t.mobileNav}>
        {mobilePrimary.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={isRouteActive(path, href) ? 'active' : ''} aria-label={label.label}>
            <Icon size={19} />
            <span className="mobile-nav-label">{label.label}</span>
          </Link>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          className={moreOpen ? 'active' : ''}
          onClick={() => {
            if (moreOpen) {
              closeMoreSheet(true);
            } else {
              restoreFocusRef.current = moreButtonRef.current;
              setMoreOpen(true);
            }
          }}
          aria-label={t.moreNav}
          aria-expanded={moreOpen}
          aria-controls="app-mobile-more-sheet"
        >
          <Menu size={19} />
          <span className="mobile-nav-label">{t.moreNav}</span>
        </button>
      </nav>

      {/* Overflow sheet */}
      <div
        className={`sheet-backdrop ${moreOpen ? 'open' : ''}`}
        onClick={() => closeMoreSheet(true)}
        aria-hidden
      />
      <div
        id="app-mobile-more-sheet"
        ref={sheetRef}
        className={`sheet ${moreOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t.moreSheetLabel}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{t.moreNav}</h2>
          <button className="btn icon" onClick={() => closeMoreSheet(true)} aria-label={t.close}>
            <X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          {mobileOverflow.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`list-row ${isRouteActive(path, href) ? 'active' : ''}`}
              onClick={() => closeMoreSheet(false)}
            >
              <div className="meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}>
                  <Icon size={15} />
                </span>
                <div>
                  <b>{label.label}</b>
                  <div className="muted small">{label.kicker}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
