'use client';
import { type CSSProperties, type ReactNode } from 'react';
import {
  Star, Cpu, Plug, Wrench, Sparkles, Boxes, ChevronRight,
} from 'lucide-react';

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
        maxWidth: 1280,
        margin: '0 auto',
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
  onClick,
}: {
  children: ReactNode;
  hero?: boolean;
  padding?: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const heroBg = hero
    ? 'radial-gradient(120% 80% at 100% 0%, rgba(56,189,248,.10) 0%, transparent 55%), var(--panel)'
    : 'var(--panel)';
  return (
    <div
      onClick={onClick}
      style={{
        padding,
        border: '1px solid var(--line)',
        borderRadius: hero ? 14 : 10,
        background: heroBg,
        cursor: onClick ? 'pointer' : 'default',
        transition: `all 200ms ${EASE}`,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
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
        letterSpacing: '.14em',
        color: 'var(--muted-2)',
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
  green: { background: 'rgba(34,197,94,.12)', color: 'var(--green)', borderColor: 'rgba(34,197,94,.30)' },
  yellow: { background: 'rgba(234,179,8,.12)', color: 'var(--yellow)', borderColor: 'rgba(234,179,8,.30)' },
  red: { background: 'rgba(239,68,68,.12)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.30)' },
  cyan: { background: 'rgba(103,232,249,.10)', color: 'var(--cyan)', borderColor: 'rgba(103,232,249,.28)' },
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
  deltaTone = 'green',
  sub,
}: {
  kicker: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: Tone;
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
          {delta ? <Tag variant={deltaTone} style={{ fontSize: 10 }}>{delta}</Tag> : null}
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
            transition: `width 300ms ${EASE}`,
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
            background: i === values.length - 1 ? 'var(--accent)' : 'rgba(56,189,248,.65)',
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
  onClick,
  icon,
  style,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 28,
        padding: '0 10px',
        borderRadius: 999,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 500,
        border: '1px solid',
        cursor: 'pointer',
        transition: `all 200ms ${EASE}`,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--muted)',
        borderColor: active ? 'var(--accent-border)' : 'var(--line)',
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

const BTN_VARIANTS: Record<BtnVariant, CSSProperties> = {
  default: { background: 'var(--panel-2)', color: 'var(--text)' },
  primary: { background: 'var(--accent)', color: '#08090c', borderColor: 'var(--accent-border)', fontWeight: 600 },
  ghost: { background: 'transparent', color: 'var(--muted)', borderColor: 'transparent' },
  danger: { background: 'rgba(239,68,68,.10)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.40)' },
};

export function Btn({
  children,
  variant = 'default',
  size = 'md',
  icon,
  onClick,
  disabled,
  type = 'button',
  style,
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: size === 'sm' ? 28 : 36,
        padding: size === 'sm' ? '0 10px' : '0 14px',
        borderRadius: 8,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: `all 200ms ${EASE}`,
        border: '1px solid var(--line)',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...BTN_VARIANTS[variant],
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
  onClick,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  first?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
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

export const KIND_ICON_MAP = {
  toolset: <Wrench size={14} />,
  skill: <Sparkles size={14} />,
  mcp: <Plug size={14} />,
  unknown: <Boxes size={14} />,
} as const;

// Re-exports so pages don't need to import lucide individually for simple things
export { Star as StarIcon, Cpu as CpuIcon, ChevronRight as ChevronRightIcon };
