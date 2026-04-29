'use client';
import { useEffect, useRef, useState } from 'react';

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, chart: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

function getTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
}

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default as MermaidApi;
      mermaid.initialize({
        startOnLoad: false,
        theme: getTheme(),
        securityLevel: 'strict',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let counter = 0;

export function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mmd-${++counter}`);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const trimmed = chart.trim();
    if (!trimmed) {
      setError('');
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }
    loadMermaid()
      .then(async (mermaid) => {
        try {
          const { svg } = await mermaid.render(idRef.current, trimmed);
          if (cancelled) return;
          if (containerRef.current) containerRef.current.innerHTML = svg;
          setError('');
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : '渲染失败');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="md-mermaid md-mermaid-error">
        <div className="md-mermaid-msg">Mermaid 渲染失败 · 显示原始代码</div>
        <pre>{chart}</pre>
      </div>
    );
  }

  return <div className="md-mermaid" ref={containerRef} aria-label="Mermaid diagram" />;
}
