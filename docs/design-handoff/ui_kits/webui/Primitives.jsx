/* global React */
const { useState, useMemo, useRef, useEffect } = React;

// ── Icon — curated lucide subset, inlined as SVG paths ─────────────────
const PATHS = {
  home:        '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  message:     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bot:         '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/>',
  cpu:         '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  radio:       '<path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48"/><circle cx="12" cy="12" r="2"/>',
  wrench:      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  terminal:    '<path d="m4 17 6-6-6-6M12 19h8"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun:         '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon:        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  panelLeft:   '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  send:        '<path d="m22 2-7 20-4-9-9-4z"/>',
  paperclip:   '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  square:      '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  check:       '<path d="M20 6 9 17l-5-5"/>',
  copy:        '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  search:      '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevR:       '<path d="m9 18 6-6-6-6"/>',
  chevD:       '<path d="m6 9 6 6 6-6"/>',
  pin:         '<path d="m12 17v5"/><path d="M9 10.76V6a3 3 0 0 1 6 0v4.76l3 4.24H6z"/>',
  more:        '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  shield:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  play:        '<polygon points="5 3 19 12 5 21 5 3"/>',
  sparkles:    '<path d="M3.5 13.5 9 12l-1.5-5.5L13.5 4l-2 6.5L17 12l-3.5 1.5L15 20l-5.5-3.5L4 19z"/>',
  pulse:       '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  database:    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  layers:      '<path d="m12 2 9 4-9 4-9-4z"/><path d="m3 14 9 4 9-4M3 10l9 4 9-4"/>',
  zap:         '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  alert:       '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  inbox:       '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  archive:     '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  network:     '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2M12 12V8"/>',
  star:        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  server:      '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  activity:    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  plug:        '<path d="M9 2v4M15 2v4M5 10h14a2 2 0 0 1 2 2v0a4 4 0 0 1-4 4h-1v3a3 3 0 0 1-6 0v-3H8a4 4 0 0 1-4-4v0a2 2 0 0 1 1-2z"/>',
  key:         '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3 1.5-1.5-3-3"/>',
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  boxes:       '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 1.03 1.71l3 1.71a2 2 0 0 0 1.94 0L11 19.27v-5.43l-4.03-2.3a2 2 0 0 0-1.94 0z"/><path d="M7 16.5l-4.74-2.85M7 16.5l5-3M7 16.5v5.17M12 13.84V8.41a2 2 0 0 0-1.03-1.71l-3-1.71a2 2 0 0 0-1.94 0L3 6.71M12 13.84l5-3M22 14.63v3.24a2 2 0 0 1-1.03 1.71l-3 1.71a2 2 0 0 1-1.94 0L13 19.27v-5.43l4.03-2.3a2 2 0 0 1 1.94 0l3 1.71a2 2 0 0 1 1.03 1.71z"/><path d="M17 16.5l5-3M17 16.5l-5-3M17 16.5v5.17"/>',
  refresh:     '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  trash:       '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  monitor:     '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  wifiOff:     '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
};
function Icon({ name, size = 14, color = 'currentColor', strokeWidth = 2, style }) {
  const d = PATHS[name] || '';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" style={style}
      dangerouslySetInnerHTML={{ __html: d }} />
  );
}

// ── Buttons ────────────────────────────────────────────────────────────
function Btn({ children, variant = 'default', size = 'md', icon, onClick, style, disabled }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: size === 'sm' ? 28 : 36, padding: size === 'sm' ? '0 10px' : '0 14px',
    borderRadius: 8, fontFamily: 'var(--font-sans)',
    fontSize: 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
    border: '1px solid var(--line)',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
  const variants = {
    default: { background: 'var(--panel-2)', color: 'var(--text)' },
    primary: { background: 'var(--accent)', color: '#08090c', borderColor: 'var(--accent-border)', fontWeight: 600 },
    ghost:   { background: 'transparent', color: 'var(--muted)', borderColor: 'transparent' },
    danger:  { background: 'rgba(239,68,68,.10)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.40)' },
    iconOnly:{ background: 'var(--panel-2)', color: 'var(--text)', padding: 0, width: 32, justifyContent: 'center' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {icon ? <Icon name={icon} size={variant === 'primary' ? 14 : 13}/> : null}
      {children}
    </button>
  );
}

// ── Card primitives ────────────────────────────────────────────────────
function Card({ children, hero, style, onClick, hover, padding = 18 }) {
  const heroBg = hero
    ? 'radial-gradient(120% 80% at 100% 0%, rgba(56,189,248,.10) 0%, transparent 55%), var(--panel)'
    : 'var(--panel)';
  return (
    <div onClick={onClick} style={{
      padding,
      border: '1px solid var(--line)',
      borderRadius: hero ? 14 : 10,
      background: heroBg,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

function Kicker({ children, color = 'var(--muted-2)', style }) {
  return <div style={{
    fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em',
    color, fontWeight: 500, ...style,
  }}>{children}</div>;
}

function Tag({ children, variant = 'default', icon, style }) {
  const variants = {
    default: { background: 'var(--panel-2)', color: 'var(--value-text)', borderColor: 'var(--line)' },
    accent:  { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-border)' },
    green:   { background: 'rgba(34,197,94,.12)', color: 'var(--green)', borderColor: 'rgba(34,197,94,.30)' },
    yellow:  { background: 'rgba(234,179,8,.12)', color: 'var(--yellow)', borderColor: 'rgba(234,179,8,.30)' },
    red:     { background: 'rgba(239,68,68,.12)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.30)' },
    cyan:    { background: 'rgba(103,232,249,.10)', color: 'var(--cyan)', borderColor: 'rgba(103,232,249,.28)' },
  };
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999,
    fontSize: 10.5, fontWeight: 500, border: '1px solid', whiteSpace: 'nowrap',
    ...variants[variant], ...style,
  }}>
    {icon ? <Icon name={icon} size={11}/> : null}
    {children}
  </span>;
}

function MetricCard({ kicker, value, delta, deltaTone = 'green', sub }) {
  return (
    <Card>
      <Kicker style={{ marginBottom: 6 }}>{kicker}</Kicker>
      <div style={{
        fontSize: 32, lineHeight: 1, fontWeight: 680, letterSpacing: '-.05em',
        color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        {delta ? <Tag variant={deltaTone} style={{ fontSize: 10 }}>{delta}</Tag> : null}
        {sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}
      </div>
    </Card>
  );
}

function BarRow({ label, value, max = 100, raw }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
      <div style={{ height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 300ms cubic-bezier(.16,1,.3,1)' }}/>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--value-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{raw}</span>
    </div>
  );
}

function Sparkline({ values, height = 48 }) {
  const max = Math.max(...values);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${Math.max(6, (v / max) * 100)}%`,
          background: i === values.length - 1 ? 'var(--accent)' : 'rgba(56,189,248,.65)',
          borderRadius: 2,
        }}/>
      ))}
    </div>
  );
}

window.HD = { Icon, Btn, Card, Kicker, Tag, MetricCard, BarRow, Sparkline };
