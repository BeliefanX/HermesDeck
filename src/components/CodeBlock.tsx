'use client';
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { MermaidBlock } from './MermaidBlock';

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
          aria-label="复制代码"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check size={11} /> 已复制
            </>
          ) : (
            <>
              <Copy size={11} /> 复制
            </>
          )}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
