'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import {
  Bot, Home, MessageSquare, Settings, Terminal, Wrench, Radio,
  Sun, Moon, Menu, X, PanelLeftClose, PanelLeftOpen, Cpu,
} from 'lucide-react';

const SIDEBAR_KEY = 'hermesdeck-sidebar-collapsed';

type IconType = ComponentType<{ size?: number | string; className?: string }>;
type NavItem = { href: string; label: string; icon: IconType; group: string };

const NAV: NavItem[] = [
  { href: '/',          label: '控制中心', icon: Home,          group: '总览' },
  { href: '/chat',      label: '对话',     icon: MessageSquare, group: '总览' },
  { href: '/profiles',  label: 'Profiles', icon: Bot,           group: '上下文' },
  { href: '/models',    label: 'Models',   icon: Cpu,           group: '上下文' },
  { href: '/runs',      label: 'Runs',     icon: Radio,         group: '运行' },
  { href: '/tools',     label: 'Tools',    icon: Wrench,        group: '运行' },
  { href: '/terminal',  label: '终端',     icon: Terminal,      group: '系统' },
  { href: '/settings',  label: '设置',     icon: Settings,      group: '系统' },
];

const MOBILE_PRIMARY = ['/', '/chat', '/profiles', '/terminal'] as const;
const PAGE_KICKER: Record<string, string> = {
  '/':         'COMMAND DECK',
  '/chat':     'CONVERSATIONS',
  '/profiles': 'EXECUTION CONTEXTS',
  '/models':   'PROVIDERS & MODELS',
  '/runs':     'RUN TIMELINE',
  '/tools':    'CAPABILITIES',
  '/terminal': 'SAFE OPS',
  '/settings': 'CONFIGURATION',
};

function groupNav(items: NavItem[]): Record<string, NavItem[]> {
  return items.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as 'dark' | 'light') || 'dark';
    setTheme(current);
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => { setMoreOpen(false); }, [path]);

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

  const active = NAV.find((n) => n.href === path) || NAV[0];
  const groups = groupNav(NAV);

  const renderSidebarLink = ({ href, label, icon: Icon }: NavItem) => (
    <Link key={href} href={href} className={path === href ? 'active' : ''} aria-label={label} title={collapsed ? label : undefined}>
      <Icon size={16} />
      <span className="nav-label">{label}</span>
    </Link>
  );

  const mobilePrimary = MOBILE_PRIMARY.map((href) => NAV.find((n) => n.href === href)!).filter(Boolean);
  const mobileOverflow = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href as (typeof MOBILE_PRIMARY)[number]));

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Desktop sidebar */}
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-badge" aria-hidden>
            <img className="brand-mark" src="/icons/icon-192.png" alt="" />
          </div>
          <div className="brand-text">
            <div className="brand-title">HermesDeck</div>
            <div className="brand-subtitle">Hermes native console</div>
          </div>
        </div>
        <nav className="nav">
          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName}>
              <div className="nav-section">{groupName}</div>
              {items.map(renderSidebarLink)}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-footer">
            <div className="label">Runtime</div>
            <div className="value">API Server · SSE · state.db</div>
            <div className="tiny" style={{ marginTop: 4 }}>
              Profiles, runs and tool events are first-class.
            </div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
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
            <div className="topbar-title">
              <span className="crumb">{PAGE_KICKER[active.href] || 'HERMESDECK'}</span>
              <h1>{active.label}</h1>
            </div>
          </div>
          <div className="topbar-meta">
            <button
              className="btn icon ghost"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
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
              <img className="brand-mark" src="/icons/icon-192.png" alt="" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="ab-title">{active.label}</div>
              <div className="ab-sub">{PAGE_KICKER[active.href] || 'HERMESDECK'}</div>
            </div>
          </div>
          <div className="ab-actions">
            <button
              className="btn icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              suppressHydrationWarning
            >
              {mounted ? (theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />) : <Moon size={15} />}
            </button>
          </div>
        </header>

        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" aria-label="移动端主导航">
        {mobilePrimary.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={path === href ? 'active' : ''} aria-label={label}>
            <Icon size={19} />
            <span className="mobile-nav-label">{label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={moreOpen ? 'active' : ''}
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="更多导航"
          aria-expanded={moreOpen}
        >
          <Menu size={19} />
          <span className="mobile-nav-label">更多</span>
        </button>
      </nav>

      {/* Overflow sheet */}
      <div
        className={`sheet-backdrop ${moreOpen ? 'open' : ''}`}
        onClick={() => setMoreOpen(false)}
        aria-hidden
      />
      <div className={`sheet ${moreOpen ? 'open' : ''}`} role="dialog" aria-label="更多导航">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>更多</h2>
          <button className="btn icon" onClick={() => setMoreOpen(false)} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          {mobileOverflow.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`list-row ${path === href ? 'active' : ''}`}
              onClick={() => setMoreOpen(false)}
              style={path === href ? { borderColor: 'rgba(124,108,255,.36)' } : undefined}
            >
              <div className="meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}>
                  <Icon size={15} />
                </span>
                <div>
                  <b>{label}</b>
                  <div className="muted small">{PAGE_KICKER[href]}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
