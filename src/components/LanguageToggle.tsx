'use client';
import { Globe } from 'lucide-react';
import { toggleLang, useLang, useT } from '@/lib/i18n';

type LanguageToggleProps = {
  className?: string;
  variant?: 'button' | 'chip';
  style?: React.CSSProperties;
};

export function LanguageToggle({ className = 'btn icon ghost', variant = 'button', style }: LanguageToggleProps) {
  const lang = useLang();
  const t = useT({
    zh: {
      aria: '切换到英文',
      title: '切换到 English',
      label: 'EN',
    },
    en: {
      aria: 'Switch to Chinese',
      title: 'Switch to 中文',
      label: '中',
    },
  });
  return (
    <button
      type="button"
      className={className}
      onClick={toggleLang}
      aria-label={t.aria}
      title={t.title}
      suppressHydrationWarning
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        ...(variant === 'chip' ? { minWidth: 44, height: 28, padding: '0 8px' } : null),
        ...style,
      }}
    >
      <Globe size={14} />
      <span>{lang === 'zh' ? 'EN' : t.label}</span>
    </button>
  );
}
