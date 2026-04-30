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
        aria-label="Copy message"
        title="Copy message"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {canRegenerate && onRegenerate && (
        <button
          type="button"
          className="msg-action"
          onClick={onRegenerate}
          disabled={busy}
          aria-label="Regenerate response"
          title="Regenerate response"
        >
          <RefreshCw size={12} />
          <span>Regenerate</span>
        </button>
      )}
    </div>
  );
}
