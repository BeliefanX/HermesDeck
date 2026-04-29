'use client';
import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';

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
}

export const MessageContent = memo(function MessageContent({ content }: Props) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          rehypeKatex,
        ]}
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
          a: ({ children, href, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
