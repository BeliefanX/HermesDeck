'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import {
  Bot, Cpu, Home, Menu, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen,
  Radio, Search, Settings, Sun, Terminal, Wrench, X,
} from 'lucide-react';

const SIDEBAR_KEY = 'hermesdeck-sidebar-collapsed';

type IconType = ComponentType<{ size?: number | string; className?: string }>;
type NavItem = { href: string; label: string; icon: IconType; kicker: string };

const NAV: NavItem[] = [
  { href: '/',         label: 'Home',     icon: Home,          kicker: 'COMMAND DECK' },
  { href: '/chat',     label: 'Chat',     icon: MessageSquare, kicker: 'CONVERSATIONS' },
  { href: '/profiles', label: 'Profiles', icon: Bot,           kicker: 'EXECUTION CONTEXTS' },
  { href: '/models',   label: 'Models',   icon: Cpu,           kicker: 'MODEL CATALOG' },
  { href: '/runs',     label: 'Runs',     icon: Radio,         kicker: 'RUN TIMELINE' },
  { href: '/tools',    label: 'Tools',    icon: Wrench,        kicker: 'TOOLSETS · MCP' },
  { href: '/terminal', label: 'Terminal', icon: Terminal,      kicker: 'SAFE OPS CONSOLE' },
  { href: '/settings', label: 'Settings', icon: Settings,      kicker: 'SETTINGS' },
];

const MOBILE_PRIMARY: ReadonlySet<string> = new Set(['/', '/chat', '/profiles', '/terminal']);

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
      if (localStorage.getItem(SIDEBAR_KEY) === '1') setCollapsed(true);
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
  const ActiveIcon = active.icon;
  const mobilePrimary = NAV.filter((n) => MOBILE_PRIMARY.has(n.href));
  const mobileOverflow = NAV.filter((n) => !MOBILE_PRIMARY.has(n.href));

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Desktop sidebar */}
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand" style={{ alignItems: 'center' }}>
          <div className="brand-badge" aria-hidden>
            <img className="brand-mark" src="/icons/icon-192.png" alt="" />
          </div>
          {!collapsed && (
            <div className="brand-text">
              <div className="brand-title">HermesDeck</div>
              <div className="brand-subtitle">CONTROL · v1</div>
            </div>
          )}
        </div>

        <nav className="nav" aria-label="Pages">
          {NAV.map(({ href, label, icon: Icon }) => {
            const isActive = path === href;
            return (
              <Link
                key={href}
                href={href}
                className={isActive ? 'active' : ''}
                aria-label={label}
                title={collapsed ? label : undefined}
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
                <span className="nav-label">{label}</span>
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
                  background: 'var(--green)', boxShadow: '0 0 0 3px rgba(34,197,94,.18)',
                }} />
                <span className="value" style={{ fontFamily: 'var(--font-sans)', fontSize: 11 }}>API</span>
                <span className="tiny" style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>online</span>
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                Profiles, runs and tool events are first-class.
              </div>
            </div>
          )}
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            <div className="topbar-title">
              <span className="crumb">{active.kicker}</span>
              <h1>{active.label}</h1>
            </div>
          </div>
          <div className="topbar-meta" style={{ flex: 1, justifyContent: 'flex-end', maxWidth: '100%' }}>
            <div
              className="topbar-search"
              role="search"
              aria-label="Search"
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
              }}>Search sessions, tools…</span>
              <span className="kbd" style={{ marginLeft: 'auto', flexShrink: 0 }}>⌘K</span>
            </div>
            <button
              className="btn icon ghost"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
              <div className="ab-sub">{active.kicker}</div>
            </div>
          </div>
          <div className="ab-actions">
            <button
              className="btn icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              suppressHydrationWarning
            >
              {mounted ? (theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />) : <Moon size={15} />}
            </button>
          </div>
        </header>

        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" aria-label="Mobile navigation">
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
          aria-label="More"
          aria-expanded={moreOpen}
        >
          <Menu size={19} />
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>

      {/* Overflow sheet */}
      <div
        className={`sheet-backdrop ${moreOpen ? 'open' : ''}`}
        onClick={() => setMoreOpen(false)}
        aria-hidden
      />
      <div className={`sheet ${moreOpen ? 'open' : ''}`} role="dialog" aria-label="More navigation">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>More</h2>
          <button className="btn icon" onClick={() => setMoreOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          {mobileOverflow.map(({ href, label, icon: Icon, kicker }) => (
            <Link
              key={href}
              href={href}
              className={`list-row ${path === href ? 'active' : ''}`}
              onClick={() => setMoreOpen(false)}
            >
              <div className="meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}>
                  <Icon size={15} />
                </span>
                <div>
                  <b>{label}</b>
                  <div className="muted small">{kicker}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
