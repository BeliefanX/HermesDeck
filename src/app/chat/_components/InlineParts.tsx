'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const selectStyle: React.CSSProperties = {
  height: 30,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--bg-soft)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12.5,
  cursor: 'pointer',
  outline: 'none',
  width: '100%',
};

export const composerSelectStyle: React.CSSProperties = {
  height: 26,
  padding: '0 6px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg-soft)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  cursor: 'pointer',
  outline: 'none',
  minWidth: 0,
  maxWidth: 200,
  textOverflow: 'ellipsis',
};

export const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'var(--panel-2)',
  border: '1px solid var(--line)',
  color: 'var(--muted)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
};

export function TabBtn({
  active, onClick, icon, children,
}: {
  active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 26,
        padding: '0 10px',
        borderRadius: 999,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--muted)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
        fontFamily: 'var(--font-sans)',
        fontSize: 11.5,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function ComposerPicker({
  label, title, value, options, onChange, disabled, placeholder, defaultTagLabel,
}: {
  label: string;
  title?: string;
  value: string;
  options: Array<{ value: string; label: string; isDefault?: boolean }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  defaultTagLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // pointerdown covers both mouse and touch in a single listener — mousedown
    // alone misses the first tap on iOS.
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const display = value || placeholder || '—';
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0, flexShrink: 1 }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={label}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 26,
          padding: '0 8px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--bg-soft)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          maxWidth: '100%',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{display}</span>
        <ChevronDown size={11} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            maxHeight: 280,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-pop)',
            padding: 4,
            zIndex: 30,
          }}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 5,
                  border: 'none',
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
                {opt.isDefault && <DefaultTag label={defaultTagLabel} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DefaultTag({ label }: { label?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 14,
        padding: '0 5px',
        borderRadius: 3,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        flexShrink: 0,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label ?? 'default'}
    </span>
  );
}
