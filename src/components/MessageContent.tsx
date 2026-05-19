'use client';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from './ErrorBoundary';

// react-markdown + remark-{gfm,math,breaks} + rehype-{katex,highlight} pulls
// in ~200KB+ of JS gzipped. Loading it eagerly delays the chat page's TTI.
// We dynamic-import it with SSR off so the server doesn't ship the bundle, and
// it splits into its own chunk that loads alongside the first message render.
const MessageContentLazy = dynamic(() => import('./MessageContentInner'), {
  ssr: false,
  loading: ({ isLoading }) => (isLoading ? <div className="md md-loading" /> : null),
});

interface Props {
  content: string;
  /** When true, render with the lightweight pipeline (no rehype-highlight /
   *  rehype-katex). Streaming sets this true; we re-render with the full
   *  pipeline when the stream resolves. */
  streaming?: boolean;
}

/**
 * Wraps the heavy markdown/math/mermaid pipeline in an ErrorBoundary so a
 * single malformed assistant message can't crash the whole chat view. On
 * render failure we fall back to the raw text so the user still sees the
 * answer (just without formatting).
 */
export function MessageContent({ content, streaming }: Props) {
  return (
    <ErrorBoundary
      fallback={() => (
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--text)' }}>
          {content}
        </pre>
      )}
    >
      <MessageContentLazy content={content} streaming={streaming} />
    </ErrorBoundary>
  );
}
