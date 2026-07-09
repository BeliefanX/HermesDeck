'use client';
import { AlertCircle, Download, FileText, File as FileIcon, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { type AttachmentItem, formatBytes } from '@/lib/attachments';
import { useT } from '@/lib/i18n';
import { safeAttachmentDownloadUrl, safeAttachmentImageUrl } from '@/lib/safe-links';

interface Props {
  item: AttachmentItem;
  onRemove?: () => void;
  onPreview?: () => void;
  /** Read-only mode — used when rendering attachments inside a sent message. */
  readOnly?: boolean;
}

export function AttachmentChip({ item, onRemove, onPreview, readOnly }: Props) {
  const t = useT({
    zh: {
      processing: '处理中',
      image: '图片',
      text: '文本',
      file: '文件',
      failed: '失败',
      remove: '移除附件',
      download: '下载',
      open: '打开预览',
    },
    en: {
      processing: 'Processing',
      image: 'image',
      text: 'text',
      file: 'file',
      failed: 'Failed',
      remove: 'Remove attachment',
      download: 'Download',
      open: 'Open preview',
    },
  });
  const isImage = item.kind === 'image';
  const isFile = item.kind === 'file';
  const title = item.error ? `${item.name} — ${item.error}` : [item.name, item.provenance].filter(Boolean).join(' — ');
  // Download href: prefer dataUrl (works offline), fall back to sanitized remote url.
  const downloadHref = safeAttachmentDownloadUrl(item.dataUrl) || safeAttachmentDownloadUrl(item.url) || '';
  const showDownload = readOnly && item.status === 'ready' && !!downloadHref;
  // Pick the chip thumbnail source for images. Either base64 inline or a
  // remote URL that the upstream provider returned.
  const imgSrc = isImage ? (safeAttachmentImageUrl(item.dataUrl) || safeAttachmentImageUrl(item.url) || '') : '';
  const kindLabel = isImage ? t.image : isFile ? t.file : t.text;

  const body = (
    <>
      {isImage && imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt={item.name} className="att-thumb" />
      ) : (
        <div className="att-icon">
          {isImage ? <ImageIcon size={14} /> : isFile ? <FileIcon size={14} /> : <FileText size={14} />}
        </div>
      )}
      <div className="att-meta">
        <div className="att-name" title={item.name}>{item.name}</div>
        <div className="att-sub">
          {item.status === 'loading' && (
            <>
              <Loader2 size={11} className="spin" /> {t.processing}
            </>
          )}
          {item.status === 'ready' && (
            <span>
              {kindLabel}{item.size ? ` · ${formatBytes(item.size)}` : ''}{item.provenance ? ` · ${item.provenance}` : ''}
            </span>
          )}
          {item.status === 'error' && (
            <>
              <AlertCircle size={11} /> {item.error || t.failed}
            </>
          )}
        </div>
      </div>
    </>
  );

  // Use a non-interactive wrapper. The preview area becomes its own <button>
  // so that nested download / remove controls don't violate the no-nested-
  // interactives ARIA rule (a previous version made the wrapper itself
  // role="button" with `<a>` and `<button>` inside).
  const className = `att-chip ${item.status}${isImage ? ' is-image' : ''}${isFile ? ' is-file' : ''}${readOnly ? ' read-only' : ''}`;
  return (
    <div className={className} title={title}>
      {onPreview ? (
        <button
          type="button"
          className="att-preview-target"
          onClick={onPreview}
          aria-label={`${t.open} — ${item.name}`}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: 0,
            font: 'inherit',
            color: 'inherit',
            textAlign: 'inherit',
            display: 'contents',
            cursor: 'pointer',
          }}
        >
          {body}
        </button>
      ) : (
        body
      )}
      {showDownload && (
        <a
          className="att-action"
          href={downloadHref}
          download={item.name}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.download}
          title={t.download}
        >
          <Download size={12} />
        </a>
      )}
      {!readOnly && onRemove && (
        <button
          type="button"
          className="att-remove"
          onClick={onRemove}
          aria-label={t.remove}
          title={t.remove}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
