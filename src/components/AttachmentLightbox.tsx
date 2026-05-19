'use client';
import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface Props {
  src: string;
  name?: string;
  onClose: () => void;
}

/**
 * Full-screen image preview. Used when the user clicks an image attachment
 * (uploaded or AI-generated) inside a chat message. ESC / backdrop click
 * dismisses; the download button saves the image via the same data/blob URL
 * the model returned, so we don't need a server round-trip.
 */
export function AttachmentLightbox({ src, name, onClose }: Props) {
  const t = useT({
    zh: { close: '关闭', download: '下载' },
    en: { close: 'Close', download: 'Download' },
  });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    // Pull focus into the toolbar so keyboard users have a starting point.
    const first = toolbarRef.current?.querySelector<HTMLElement>('button, a');
    first?.focus();

    const focusables = (): HTMLElement[] => {
      const tb = toolbarRef.current;
      if (!tb) return [];
      return Array.from(tb.querySelectorAll<HTMLElement>('button, a'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0]!;
        const last = els[els.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !toolbarRef.current?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        try { (previouslyFocused.current as HTMLElement).focus(); } catch {}
      }
    };
  }, [onClose]);

  const fileName = name || 'image';
  // Browsers ignore `download` on cross-origin URLs (it just opens in a new
  // tab). For absolute http(s) URLs we route through a hidden fetch+blob to
  // make the download attribute take effect.
  const handleDownload = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!/^https?:/i.test(src)) return; // data: / blob: already obey download
    e.preventDefault();
    try {
      const r = await fetch(src);
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch { /* fall back to default link behavior */ }
  };

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={fileName}>
      <div className="lightbox-toolbar" ref={toolbarRef} onClick={(e) => e.stopPropagation()}>
        <a
          className="btn icon sm"
          href={src}
          download={fileName}
          aria-label={t.download}
          title={t.download}
          onClick={handleDownload}
        >
          <Download size={14} />
        </a>
        <button className="btn icon sm" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={14} />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={fileName}
        className="lightbox-img"
        loading="eager"
        decoding="async"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
