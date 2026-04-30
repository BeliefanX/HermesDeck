'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

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
  title, description, initialValue, placeholder, confirmLabel = 'Confirm', onConfirm, onCancel, helper,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h3>{title}</h3>
            {description && <div className="muted small" style={{ marginTop: 4 }}>{description}</div>}
          </div>
          <button className="btn icon sm" onClick={onCancel} aria-label="Close"><X size={14} /></button>
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
          <button className="btn sm" onClick={onCancel}>Cancel</button>
          <button
            className="btn sm primary"
            onClick={() => onConfirm(ref.current?.value ?? '')}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
