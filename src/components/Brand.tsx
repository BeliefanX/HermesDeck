'use client';
import { type CSSProperties, type ReactNode } from 'react';

// Shared design-system primitives — one-to-one with docs/design-handoff/ui_kits/webui/Primitives.jsx
// Inline-styled with CSS variables so themes (data-theme="dark|light") swap without rebuilds.

const EASE = 'cubic-bezier(.2,.7,.2,1)';

export type Tone = 'default' | 'accent' | 'green' | 'yellow' | 'red' | 'cyan';

export function Page({ intro, children, style }: { intro?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="brand-page"
      style={{
        padding: 'clamp(16px, 1.8vw, 28px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 'none',
        margin: 0,
        width: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {intro ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 760 }}>
          {intro}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        padding: '1px 6px',
        borderRadius: 4,
        background: 'var(--panel-2)',
        border: '1px solid var(--line)',
        color: 'var(--value-text)',
      }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  hero = false,
  padding = 18,
  style,
  className,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  hero?: boolean;
  padding?: number;
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const heroBg = hero ? 'var(--card-bg)' : 'var(--panel)';
  const cardClassName = ['brand-card', hero ? 'brand-card-hero' : '', onClick ? 'is-clickable' : '', className || '']
    .filter(Boolean)
    .join(' ');
  // Promote the wrapper to a semantic <button> when an onClick is supplied so
  // keyboard users can actually activate the card. Falls back to a plain div
  // when there's no interaction — preserves the original styling unchanged.
  const sharedStyle: CSSProperties = {
    padding,
    border: '1px solid var(--line)',
    borderRadius: hero ? 'var(--r-4)' : 'var(--r-2)',
    background: heroBg,
    cursor: onClick ? 'pointer' : 'default',
    transition: `border-color 200ms ${EASE}, background 200ms ${EASE}, transform 160ms ${EASE}`,
    position: 'relative',
    overflow: 'hidden',
    ...style,
  };
  if (onClick) {
    return (
      <button
        type="button"
        className={cardClassName}
        data-state="interactive"
        onClick={onClick}
        aria-label={ariaLabel}
        style={{
          ...sharedStyle,
          textAlign: 'inherit' as CSSProperties['textAlign'],
          font: 'inherit',
          color: 'inherit',
          width: '100%',
          display: 'block',
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cardClassName} data-state="default" style={sharedStyle}>
      {children}
    </div>
  );
}

export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        textTransform: 'uppercase',
        letterSpacing: '.10em',
        color: 'var(--muted-2)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const TAG_VARIANTS: Record<Tone, CSSProperties> = {
  default: { background: 'var(--panel-2)', color: 'var(--value-text)', borderColor: 'var(--line)' },
  accent: { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-border)' },
  green: { background: 'var(--status-green-bg)', color: 'var(--green)', borderColor: 'var(--status-green-border)' },
  yellow: { background: 'var(--status-yellow-bg)', color: 'var(--yellow)', borderColor: 'var(--status-yellow-border)' },
  red: { background: 'var(--status-red-bg)', color: 'var(--red)', borderColor: 'var(--status-red-border)' },
  cyan: { background: 'var(--status-cyan-bg)', color: 'var(--cyan)', borderColor: 'var(--status-cyan-border)' },
};

export function Tag({
  children,
  variant = 'default',
  icon,
  style,
}: {
  children: ReactNode;
  variant?: Tone;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 500,
        border: '1px solid',
        whiteSpace: 'nowrap',
        ...TAG_VARIANTS[variant],
        ...style,
      }}
    >
      {icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </span>
  );
}

export function MetricCard({
  kicker,
  value,
  delta,
  sub,
}: {
  kicker: string;
  value: ReactNode;
  delta?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card>
      <Kicker style={{ marginBottom: 6 }}>{kicker}</Kicker>
      <div
        style={{
          fontSize: 32,
          lineHeight: 1,
          fontWeight: 680,
          letterSpacing: '-.05em',
          color: 'var(--strong-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {(delta || sub) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
          {delta ? <Tag variant="green" style={{ fontSize: 10 }}>{delta}</Tag> : null}
          {sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}
        </div>
      )}
    </Card>
  );
}

export function BarRow({
  label,
  value,
  max = 100,
  raw,
}: {
  label: ReactNode;
  value: number;
  max?: number;
  raw: ReactNode;
}) {
  const pct = Math.max(2, (value / Math.max(max, 1)) * 100);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div style={{ height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent)',
            borderRadius: 3,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--value-text)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {raw}
      </span>
    </div>
  );
}

export function Sparkline({ values, height = 48 }: { values: number[]; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: i === values.length - 1 ? 'var(--accent)' : 'var(--accent-strong)',
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

export function Chip({
  children,
  active = false,
  state = 'default',
  disabled = false,
  className,
  onClick,
  icon,
  style,
}: {
  children: ReactNode;
  active?: boolean;
  state?: 'default' | 'loading' | 'success' | 'error';
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  const chipClassName = ['chip', active ? 'active' : '', className || ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={chipClassName}
      data-state={state === 'default' ? undefined : state}
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 28,
        flexShrink: 0,
        ...style,
      }}
    >
      {icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </button>
  );
}

export function SectionHead({
  kicker,
  title,
  right,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 620,
            letterSpacing: '-.012em',
            color: 'var(--strong-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {title}
        </h2>
      </div>
      {right ? <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>{right}</div> : null}
    </div>
  );
}

export type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type PrimitiveState = 'default' | 'loading' | 'success' | 'error';

export function Btn({
  children,
  variant = 'default',
  size = 'md',
  state = 'default',
  loading = false,
  icon,
  onClick,
  disabled,
  type = 'button',
  className,
  style,
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  state?: PrimitiveState;
  loading?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
}) {
  const stateName = loading ? 'loading' : state;
  const btnClassName = [
    'btn',
    variant !== 'default' ? variant : '',
    size === 'sm' ? 'sm' : '',
    icon && !children ? 'icon' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={btnClassName}
      data-state={stateName === 'default' ? undefined : stateName}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={{
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      {icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </button>
  );
}

export function ListRow({
  icon,
  title,
  sub,
  right,
  first = false,
  state = 'default',
  className,
  onClick,
  ariaLabel,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  first?: boolean;
  state?: PrimitiveState;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const rowClassName = ['brand-list-row', onClick ? 'is-clickable' : '', className || ''].filter(Boolean).join(' ');
  return (
    <div
      className={rowClassName}
      data-state={state}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? ariaLabel : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: 'var(--surface-bg)',
          border: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>{title}</div>
        {sub ? (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--muted)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
      {right}
    </div>
  );
}
