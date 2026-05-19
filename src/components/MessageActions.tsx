'use client';
import { memo, useState } from 'react';
import { AlertCircle, Check, Copy, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface Props {
  content: string;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  busy?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

export const MessageActions = memo(function MessageActions({ content, canRegenerate, onRegenerate, busy }: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const t = useT({
    zh: {
      copy: '复制',
      copied: '已复制',
      failed: '复制失败',
      copyMessage: '复制消息',
      regenerate: '重新生成',
      regenerateResponse: '重新生成回复',
    },
    en: {
      copy: 'Copy',
      copied: 'Copied',
      failed: 'Copy failed',
      copyMessage: 'Copy message',
      regenerate: 'Regenerate',
      regenerateResponse: 'Regenerate response',
    },
  });

  // Best-effort fallback for browsers without clipboard API access (HTTP
  // contexts, locked-down embeds): create a hidden textarea, select, exec.
  const legacyCopy = (text: string): boolean => {
    if (typeof document === 'undefined') return false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  const onCopy = async () => {
    if (!content) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        ok = true;
      } else {
        ok = legacyCopy(content);
      }
    } catch {
      // Permission denied / writeText threw — fall back to the textarea trick.
      ok = legacyCopy(content);
    }
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), ok ? 1400 : 2200);
  };

  if (!content) return null;

  const Icon = copyState === 'copied' ? Check : copyState === 'failed' ? AlertCircle : Copy;
  const label = copyState === 'copied' ? t.copied : copyState === 'failed' ? t.failed : t.copy;

  return (
    <div className="msg-actions">
      <button
        type="button"
        className={`msg-action${copyState === 'failed' ? ' is-error' : ''}`}
        onClick={onCopy}
        aria-label={t.copyMessage}
        title={t.copyMessage}
      >
        <Icon size={12} />
        <span>{label}</span>
      </button>
      {canRegenerate && onRegenerate && (
        <button
          type="button"
          className="msg-action"
          onClick={onRegenerate}
          disabled={busy}
          aria-label={t.regenerateResponse}
          title={t.regenerateResponse}
        >
          <RefreshCw size={12} />
          <span>{t.regenerate}</span>
        </button>
      )}
    </div>
  );
});
