'use client';
import { memo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { MermaidBlock as MermaidBlockBase } from './MermaidBlock';

// Memoized at the call site rather than inside MermaidBlock.tsx — Turbopack's
// HMR boundary chokes on `'use client'` files whose only export is a memo()
// expression. Memo is what we actually want: chat thread re-renders shouldn't
// re-run mermaid.render() unless the chart string changes.
const MermaidBlock = memo(MermaidBlockBase);

interface Props {
  language: string;
  raw: string;
  children: ReactNode;
}

export function CodeBlock({ language, raw, children }: Props) {
  const [copied, setCopied] = useState(false);

  if (language === 'mermaid') {
    return <MermaidBlock chart={raw.trimEnd()} />;
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore — clipboard may be unavailable in non-secure contexts
    }
  };

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{language || 'text'}</span>
        <button
          type="button"
          className="md-code-copy"
          onClick={onCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={11} /> Copied
            </>
          ) : (
            <>
              <Copy size={11} /> Copy
            </>
          )}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
