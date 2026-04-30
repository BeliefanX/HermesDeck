'use client';
import { AlertCircle, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { type AttachmentItem, formatBytes } from '@/lib/attachments';

interface Props {
  item: AttachmentItem;
  onRemove?: () => void;
  onPreview?: () => void;
  /** Read-only mode — used when rendering attachments inside a sent message. */
  readOnly?: boolean;
}

export function AttachmentChip({ item, onRemove, onPreview, readOnly }: Props) {
  const isImage = item.kind === 'image';
  const title = item.error ? `${item.name} — ${item.error}` : item.name;

  const body = (
    <>
      {isImage && item.dataUrl ? (
        <img src={item.dataUrl} alt={item.name} className="att-thumb" />
      ) : (
        <div className="att-icon">
          {isImage ? <ImageIcon size={14} /> : <FileText size={14} />}
        </div>
      )}
      <div className="att-meta">
        <div className="att-name" title={item.name}>{item.name}</div>
        <div className="att-sub">
          {item.status === 'loading' && (
            <>
              <Loader2 size={11} className="spin" /> Processing
            </>
          )}
          {item.status === 'ready' && (
            <span>
              {isImage ? 'image' : 'text'} · {formatBytes(item.size)}
            </span>
          )}
          {item.status === 'error' && (
            <>
              <AlertCircle size={11} /> {item.error || 'Failed'}
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      className={`att-chip ${item.status}${isImage ? ' is-image' : ''}${readOnly ? ' read-only' : ''}`}
      title={title}
      role={onPreview ? 'button' : undefined}
      tabIndex={onPreview ? 0 : undefined}
      onClick={onPreview}
      onKeyDown={onPreview ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } } : undefined}
    >
      {body}
      {!readOnly && onRemove && (
        <button
          type="button"
          className="att-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove attachment"
          title="Remove attachment"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
