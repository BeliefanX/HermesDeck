'use client';
import { useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';

interface Props {
  content: string;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  busy?: boolean;
}

export function MessageActions({ content, canRegenerate, onRegenerate, busy }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  if (!content) return null;

  return (
    <div className="msg-actions">
      <button
        type="button"
        className="msg-action"
        onClick={onCopy}
        aria-label="复制消息"
        title="复制消息"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
      {canRegenerate && onRegenerate && (
        <button
          type="button"
          className="msg-action"
          onClick={onRegenerate}
          disabled={busy}
          aria-label="重新生成回复"
          title="重新生成回复"
        >
          <RefreshCw size={12} />
          <span>重新生成</span>
        </button>
      )}
    </div>
  );
}
