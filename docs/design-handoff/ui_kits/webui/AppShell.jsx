/* global React, HD */
const { useState } = React;

const NAV = [
  { id: 'home',     icon: 'home',     label: 'Home',     kicker: 'COMMAND DECK' },
  { id: 'chat',     icon: 'message',  label: 'Chat',     kicker: 'CONVERSATIONS' },
  { id: 'profiles', icon: 'bot',      label: 'Profiles', kicker: 'EXECUTION CONTEXTS' },
  { id: 'models',   icon: 'cpu',      label: 'Models',   kicker: 'MODEL CATALOG' },
  { id: 'runs',     icon: 'radio',    label: 'Runs',     kicker: 'RUN TIMELINE' },
  { id: 'tools',    icon: 'wrench',   label: 'Tools',    kicker: 'TOOLSETS · MCP' },
  { id: 'terminal', icon: 'terminal', label: 'Terminal', kicker: 'SAFE OPS CONSOLE' },
  { id: 'settings', icon: 'settings', label: 'Settings', kicker: 'SETTINGS' },
];

function NavRow({ item, active, collapsed, onClick }) {
  const baseStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    height: 34, padding: collapsed ? '0' : '0 8px 0 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: 8, cursor: 'pointer',
    fontSize: 13,
    transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
    color: active ? 'var(--strong-text)' : 'var(--nav-text)',
    fontWeight: active ? 550 : 400,
    background: active ? 'rgba(56,189,248,.12)' : 'transparent',
    borderLeft: active ? '2px solid rgba(56,189,248,.55)' : '2px solid transparent',
    paddingLeft: collapsed ? 0 : 10,
  };
  return (
    <div onClick={onClick} style={baseStyle}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <HD.Icon name={item.icon} size={14} color={active ? 'var(--accent)' : 'currentColor'}/>
      {!collapsed && <span>{item.label}</span>}
    </div>
  );
}

function Sidebar({ active, setActive, collapsed, setCollapsed, theme, setTheme }) {
  return (
    <aside style={{
      width: collapsed ? 60 : 248, flexShrink: 0,
      background: 'var(--sidebar-bg)', borderRight: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      padding: '14px 10px', gap: 10,
      transition: 'width 200ms cubic-bezier(.2,.7,.2,1)',
    }}>
      {/* Brand badge row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 8px' }}>
        <div style={{
          position: 'relative', width: 34, height: 34, borderRadius: 9,
          background: '#07090f', flexShrink: 0,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06), 0 0 0 3px rgba(56,189,248,.14)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src="../../assets/brand/hermesdeck-mark.svg" width="34" height="34" alt=""/>
        </div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.018em', color: 'var(--strong-text)', lineHeight: 1.1 }}>HermesDeck</span>
            <span style={{ fontSize: 9.5, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 500 }}>CONTROL · v1</span>
          </div>
        )}
      </div>

      {/* Nav rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(item => (
          <NavRow key={item.id} item={item} active={active === item.id} collapsed={collapsed}
            onClick={() => setActive(item.id)}/>
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 0 3px rgba(34,197,94,.18)' }}/>
            <span style={{ fontSize: 11, color: 'var(--value-text)' }}>API</span>
            <span style={{ fontSize: 10.5, color: 'var(--muted-2)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>3 ms</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
            background: 'transparent', border: 'none', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer',
          }}>
            <HD.Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
          </button>
          <button onClick={() => setCollapsed(!collapsed)} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
            background: 'transparent', border: 'none', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer',
          }}>
            <HD.Icon name="panelLeft" size={14}/>
          </button>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ active, theme, setTheme }) {
  const item = NAV.find(n => n.id === active) || { icon: 'wifiOff', label: 'Offline', kicker: 'PWA FALLBACK' };
  return (
    <header style={{
      height: 56, flexShrink: 0,
      borderBottom: '1px solid var(--line)',
      background: 'var(--topbar-bg)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16,
    }}>
      <HD.Icon name={item.icon} size={15} color="var(--accent)"/>
      <span style={{ fontSize: 14, fontWeight: 620, letterSpacing: '-.012em', color: 'var(--strong-text)' }}>{item.label}</span>
      <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted-2)', fontWeight: 500 }}>{item.kicker}</span>
      <div style={{ flex: 1 }}/>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', flex: 1, minWidth: 0, maxWidth: 360,
        background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8,
      }}>
        <HD.Icon name="search" size={13} color="var(--muted-2)" style={{ flexShrink: 0 }}/>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>Search sessions, tools…</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', background: 'var(--panel-2)' }}>⌘ K</span>
      </div>
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
        background: 'transparent', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer',
      }}>
        <HD.Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
      </button>
    </header>
  );
}

window.HDShell = { Sidebar, Topbar, NAV };
