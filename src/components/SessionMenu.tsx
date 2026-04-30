'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Pin, PinOff, Pencil, FolderInput, FolderMinus, Tag, Archive, ArchiveRestore, Trash2,
} from 'lucide-react';
import type { Folder } from '@/lib/session-meta';

export interface SessionMenuActions {
  onTogglePin: () => void;
  onRename: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onCreateFolderAndMove: () => void;
  onEditTags: () => void;
  onToggleArchive: () => void;
  onDelete?: () => void;
}

interface Props {
  pinned: boolean;
  archived: boolean;
  folderId?: string;
  folders: Folder[];
  canDelete: boolean;
  actions: SessionMenuActions;
  onClose: () => void;
  /** Anchor element (the kebab button). Used to compute viewport coordinates. */
  anchor: HTMLElement | null;
}

const GAP = 4;
const PAD = 8;

export function SessionMenu({ pinned, archived, folderId, folders, canDelete, actions, onClose, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; maxH: number } | null>(null);

  // Stabilize onClose so the outside-click effect's deps don't churn every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const menuH = ref.current?.offsetHeight || 0;
      const spaceBelow = vh - a.bottom - PAD;
      const spaceAbove = a.top - PAD;
      const flipUp = menuH > 0 && spaceBelow < menuH && spaceAbove > spaceBelow;
      const top = flipUp
        ? Math.max(PAD, a.top - GAP - Math.min(menuH, spaceAbove))
        : a.bottom + GAP;
      const maxH = Math.max(160, flipUp ? spaceAbove : spaceBelow);
      setPos({
        top,
        right: Math.max(PAD, vw - a.right),
        maxH,
      });
    };
    compute();
    const r = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchor]);

  // Outside-click + Escape. Stable deps ([anchor]) — onClose access via ref —
  // so this effect runs at most once per menu-open, never reattaches mid-life.
  useEffect(() => {
    if (!anchor) return;
    const onPointer = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      if (anchor.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    // Defer one tick so the click that opened us doesn't immediately close us.
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointer);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  if (!anchor) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: pos?.top ?? -9999,
    right: pos?.right ?? 0,
    maxHeight: pos?.maxH,
    overflowY: 'auto',
    visibility: pos ? 'visible' : 'hidden',
  };

  // Menu items: use onPointerDown so the action fires even if any parent click
  // handler tries to interfere. Stop propagation so it doesn't bubble to the
  // session-item's onClick (openSession).
  const item = (icon: React.ReactNode, label: string, run: () => void, opts?: { danger?: boolean }) => (
    <button
      type="button"
      className={`session-menu-item ${opts?.danger ? 'danger' : ''}`}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); run(); }}
    >
      <span className="session-menu-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      className="session-menu"
      role="menu"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {item(pinned ? <PinOff size={13} /> : <Pin size={13} />, pinned ? 'Unpin' : 'Pin', actions.onTogglePin)}
      {item(<Pencil size={13} />, 'Rename', actions.onRename)}
      {item(<Tag size={13} />, 'Edit tags', actions.onEditTags)}

      <div className="session-menu-sep" />

      {item(<FolderInput size={13} />, 'Move to new folder…', actions.onCreateFolderAndMove)}
      {folders.length > 0 && folders.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`session-menu-item ${folderId === f.id ? 'active' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); actions.onMoveToFolder(f.id); }}
        >
          <span className="session-menu-icon"><FolderInput size={13} /></span>
          <span>Move to “{f.name}”</span>
          {folderId === f.id && <span className="muted tiny" style={{ marginLeft: 'auto' }}>current</span>}
        </button>
      ))}
      {folderId && item(<FolderMinus size={13} />, 'Remove from folder', () => actions.onMoveToFolder(null))}

      <div className="session-menu-sep" />

      {item(
        archived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
        archived ? 'Unarchive' : 'Archive',
        actions.onToggleArchive,
      )}
      {canDelete && actions.onDelete && item(<Trash2 size={13} />, 'Delete locally', actions.onDelete, { danger: true })}
    </div>
  );
}
