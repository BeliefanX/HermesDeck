'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface Props {
  title: string;
  description?: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  /** Optional helper text shown under the input (e.g. "Comma-separated tags"). */
  helper?: string;
}

export function InlineDialog({
  title, description, initialValue, placeholder, confirmLabel, onConfirm, onCancel, helper,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const t = useT({
    zh: { close: '关闭', cancel: '取消', confirm: '确认' },
    en: { close: 'Close', cancel: 'Cancel', confirm: 'Confirm' },
  });
  const resolvedConfirm = confirmLabel ?? t.confirm;

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    ref.current?.focus();
    ref.current?.select();
    const card = cardRef.current;
    const focusables = (): HTMLElement[] => {
      if (!card) return [];
      return Array.from(card.querySelectorAll<HTMLElement>(
        'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hasAttribute('disabled'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      // Trap Tab so focus cycles inside the dialog instead of escaping into
      // the page behind. Without this, screen-reader users navigate into
      // controls visually obscured by the backdrop.
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0]!;
        const last = els[els.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !card?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore focus to whatever owned it before the dialog opened.
      if (previouslyFocused.current instanceof HTMLElement) {
        try { (previouslyFocused.current as HTMLElement).focus(); } catch {}
      }
    };
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h3>{title}</h3>
            {description && <div className="muted small" style={{ marginTop: 4 }}>{description}</div>}
          </div>
          <button className="btn icon sm" onClick={onCancel} aria-label={t.close}><X size={14} /></button>
        </div>
        <input
          ref={ref}
          className="input"
          defaultValue={initialValue}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirm((e.target as HTMLInputElement).value);
            }
          }}
        />
        {helper && <div className="muted tiny" style={{ marginTop: 6 }}>{helper}</div>}
        <div className="dialog-actions">
          <button className="btn sm" onClick={onCancel}>{t.cancel}</button>
          <button
            className="btn sm primary"
            onClick={() => onConfirm(ref.current?.value ?? '')}
          >{resolvedConfirm}</button>
        </div>
      </div>
    </div>
  );
}
