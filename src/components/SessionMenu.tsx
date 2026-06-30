'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Pin, PinOff, Pencil, FolderInput, FolderMinus, Tag as TagIcon, Archive, ArchiveRestore, Trash2, Eraser,
} from 'lucide-react';
import type { Folder } from '@/lib/session-meta';
import { useT } from '@/lib/i18n';

export interface SessionMenuActions {
  onTogglePin: () => void;
  onRename: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onCreateFolderAndMove: () => void;
  onEditTags: () => void;
  onToggleArchive: () => void;
  /** Permanently remove the session + messages from Hermes' state.db. */
  onDelete?: () => void;
  /** Drop only Deck metadata (pin/folder/tags/title) without touching Hermes. */
  onRemoveDeckMeta?: () => void;
}

interface Props {
  pinned: boolean;
  archived: boolean;
  folderId?: string;
  folders: Folder[];
  canDelete: boolean;
  /** True when the session has any Deck metadata that could be cleared. */
  hasDeckMeta?: boolean;
  actions: SessionMenuActions;
  onClose: () => void;
  /** Anchor element (the kebab button). Used to compute viewport coordinates. */
  anchor: HTMLElement | null;
}

const GAP = 4;
const PAD = 8;

export function SessionMenu({ pinned, archived, folderId, folders, canDelete, hasDeckMeta, actions, onClose, anchor }: Props) {
  const t = useT({
    zh: {
      pin: '置顶',
      unpin: '取消置顶',
      rename: '重命名',
      editTags: '编辑标签',
      moveToNewFolder: '移动到新文件夹…',
      moveToPrefix: '移动到',
      current: '当前',
      removeFromFolder: '从文件夹移出',
      archive: '归档',
      unarchive: '取消归档',
      removeDeckMeta: '仅清除 Deck 元数据',
      deleteFromHermes: '从 Hermes 历史中删除…',
    },
    en: {
      pin: 'Pin',
      unpin: 'Unpin',
      rename: 'Rename',
      editTags: 'Edit tags',
      moveToNewFolder: 'Move to new folder…',
      moveToPrefix: 'Move to',
      current: 'current',
      removeFromFolder: 'Remove from folder',
      archive: 'Archive',
      unarchive: 'Unarchive',
      removeDeckMeta: 'Remove Deck metadata',
      deleteFromHermes: 'Delete from Hermes history…',
    },
  });
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

  const runPointerAction = (e: React.PointerEvent<HTMLButtonElement>, run: () => void) => {
    // Fire before the browser synthesizes a click. The menu is rendered inside
    // the clickable session row, so closing/unmounting it on click can let the
    // synthetic click continue to the row and open the chat instead.
    if (typeof e.button === 'number' && e.button !== 0) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    run();
  };

  const stopClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const runKeyboardAction = (e: React.KeyboardEvent<HTMLButtonElement>, run: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  };

  // Menu items: run pointer actions on pointerdown and suppress the later click
  // so events never bubble to the session-item's onClick (openSession). Keyboard
  // activation stays explicit for accessibility.
  const item = (icon: React.ReactNode, label: string, run: () => void, opts?: { danger?: boolean }) => (
    <button
      type="button"
      role="menuitem"
      className={`session-menu-item ${opts?.danger ? 'danger' : ''}`}
      onPointerDown={(e) => runPointerAction(e, run)}
      onClick={stopClick}
      onKeyDown={(e) => runKeyboardAction(e, run)}
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
      {item(pinned ? <PinOff size={13} /> : <Pin size={13} />, pinned ? t.unpin : t.pin, actions.onTogglePin)}
      {item(<Pencil size={13} />, t.rename, actions.onRename)}
      {item(<TagIcon size={13} />, t.editTags, actions.onEditTags)}

      <div className="session-menu-sep" />

      {item(<FolderInput size={13} />, t.moveToNewFolder, actions.onCreateFolderAndMove)}
      {folders.length > 0 && folders.map((f) => (
        <button
          key={f.id}
          type="button"
          role="menuitem"
          className={`session-menu-item ${folderId === f.id ? 'active' : ''}`}
          onPointerDown={(e) => runPointerAction(e, () => actions.onMoveToFolder(f.id))}
          onClick={stopClick}
          onKeyDown={(e) => runKeyboardAction(e, () => actions.onMoveToFolder(f.id))}
        >
          <span className="session-menu-icon"><FolderInput size={13} /></span>
          <span>{t.moveToPrefix} “{f.name}”</span>
          {folderId === f.id && <span className="muted tiny" style={{ marginLeft: 'auto' }}>{t.current}</span>}
        </button>
      ))}
      {folderId && item(<FolderMinus size={13} />, t.removeFromFolder, () => actions.onMoveToFolder(null))}

      <div className="session-menu-sep" />

      {item(
        archived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
        archived ? t.unarchive : t.archive,
        actions.onToggleArchive,
      )}
      {hasDeckMeta && actions.onRemoveDeckMeta && item(
        <Eraser size={13} />,
        t.removeDeckMeta,
        actions.onRemoveDeckMeta,
      )}
      {canDelete && actions.onDelete && item(
        <Trash2 size={13} />,
        t.deleteFromHermes,
        actions.onDelete,
        { danger: true },
      )}
    </div>
  );
}
