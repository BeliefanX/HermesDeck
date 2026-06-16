'use client';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';
import { AttachmentLightbox } from './AttachmentLightbox';
import { safeAttachmentImageUrl, safeMarkdownHref } from '@/lib/safe-links';

// Hermes embeds model-generated images as filesystem paths
// (e.g. `/Users/me/.hermes/cache/images/foo.png`) inside the assistant's
// markdown. The browser would 404 trying to fetch those — we route them
// through /api/deck/cache-image which reads the file off disk. Data URLs,
// http(s) URLs, and protocol-relative URLs are passed through untouched.
function resolveImgSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('blob:')) return src;
  if (/^[a-z]+:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return src;
  if (src.startsWith('/Users/') || src.startsWith('/home/') || src.startsWith('/var/') || src.startsWith('/private/')) {
    return `/api/deck/cache-image?path=${encodeURIComponent(src)}`;
  }
  return src;
}

function reactNodeToString(node: ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToString).join('');
  if (typeof node === 'object' && 'props' in node) {
    const children = (node as { props?: { children?: ReactNode } }).props?.children;
    return reactNodeToString(children);
  }
  return '';
}

interface Props {
  content: string;
  /**
   * When true, skip the heavyweight rehype plugins (highlight + katex).
   * Streaming text changes per token; running rehype-highlight + rehype-katex
   * on every delta re-tokenizes every code block from scratch and burns CPU.
   * Final messages get the full pipeline; in-flight ones render plain
   * markdown until streaming completes, then we re-render once with full
   * formatting.
   */
  streaming?: boolean;
}

const MessageContentInner = memo(function MessageContentInner({ content, streaming }: Props) {
  // Markdown images (`![](url)`) are how plenty of providers actually deliver
  // generated artifacts — embedded as a `data:image/png;base64,...` URL inside
  // the assistant text. Without a custom renderer we'd fall back to bare
  // <img> with no max-width (huge data URLs blow up the layout) and no way to
  // click-through to view full size or download. This wires both up.
  const [preview, setPreview] = useState<{ src: string; name?: string } | null>(null);
  const rehypePlugins: ReactMarkdownOptions['rehypePlugins'] = streaming
    ? []
    : [[rehypeHighlight, { detect: true, ignoreMissing: true }] as [typeof rehypeHighlight, { detect: boolean; ignoreMissing: boolean }], rehypeKatex];
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          pre: ({ children }) => {
            const codeEl = children as { props?: { className?: string; children?: ReactNode } } | null | undefined;
            const className = codeEl?.props?.className || '';
            const langMatch = /language-([\w-]+)/.exec(className);
            const lang = langMatch?.[1] || '';
            const raw = reactNodeToString(codeEl?.props?.children);
            return (
              <CodeBlock language={lang} raw={raw}>
                {children}
              </CodeBlock>
            );
          },
          a: ({ children, href, ...rest }) => {
            const safeHref = safeMarkdownHref(href);
            if (!safeHref) {
              return <span className="md-link-disabled">{children}</span>;
            }
            const external = /^[a-z][a-z0-9+.-]*:/i.test(safeHref) || safeHref.startsWith('//');
            return (
              <a
                href={safeHref}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                {...rest}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt, title, width, height }) => {
            const url = typeof src === 'string' ? src : '';
            if (!url) return null;
            const resolved = safeAttachmentImageUrl(resolveImgSrc(url));
            if (!resolved) return null;
            return (
              <button
                type="button"
                className="md-img-btn"
                onClick={() => setPreview({ src: resolved, name: alt || 'image' })}
                aria-label={alt || 'Open image'}
                title={title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolved}
                  alt={alt || ''}
                  loading="lazy"
                  className="md-img"
                  width={width}
                  height={height}
                />
              </button>
            );
          },
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {preview && (
        <AttachmentLightbox
          src={preview.src}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
});

export default MessageContentInner;
