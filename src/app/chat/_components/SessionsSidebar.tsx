'use client';
import {
  ChevronDown, ChevronRight, Folder as FolderIcon, Inbox, ListFilter, MoreHorizontal,
  Pin, Sparkles, X,
} from 'lucide-react';
import type { DeckSession } from '@/lib/types';
import { SessionMenu } from '@/components/SessionMenu';
import {
  type Folder,
  type MetaStore,
  effectiveTitle,
  getMeta,
} from '@/lib/session-meta';
import { relTime, shortTitle, sourceMeta } from '@/lib/format';
import type { ChatT } from '../_lib/i18n';
import type { LocalSession } from '../_lib/storage';
import type { DialogState } from './Dialogs';

export type SessionGroups = {
  pinned: LocalSession[];
  folderGroups: { folder: Folder; sessions: LocalSession[] }[];
  unfoldered: LocalSession[];
  /** Count of sessions hidden by the render cap (search still finds them). */
  truncated?: number;
};

export interface SessionListActions {
  openSession: (s: LocalSession) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  moveToFolder: (id: string, folderId: string | null) => void;
  toggleFolderCollapsed: (id: string) => void;
  applyDeleteFolder: (id: string) => void;
  performRemoveDeckMeta: (id: string) => void;
  setDialog: (d: DialogState | null) => void;
  setOpenMenu: (id: string) => void;
  setMenuAnchor: (a: HTMLElement | null) => void;
}

function renderSessionItem({
  s, t, active, openMenu, menuAnchor, metaStore, showArchived, actions,
}: {
  s: LocalSession;
  t: ChatT;
  active: string;
  openMenu: string;
  menuAnchor: HTMLElement | null;
  metaStore: MetaStore;
  showArchived: boolean;
  actions: SessionListActions;
}) {
  const meta = sourceMeta(s.source);
  const sm = getMeta(metaStore, s.id);
  const time = relTime(s.updatedAt || s.createdAt);
  const title = effectiveTitle(sm, s.title);
  const folder = sm.folderId ? metaStore.folders.find((f) => f.id === sm.folderId) : null;
  const isMenuOpen = openMenu === s.id;
  const showPinIcon = !!sm.pinned;
  return (
    <div
      key={s.id}
      role="button"
      tabIndex={0}
      aria-current={s.id === active ? 'true' : undefined}
      aria-label={`${title}${s.id === active ? ' · active' : ''}`}
      className={`session-item ${s.id === active ? 'active' : ''}${sm.archived ? ' archived' : ''}`}
      onClick={() => actions.openSession(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          actions.openSession(s);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        actions.setOpenMenu(s.id);
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span className={`tag ${meta.tone}`} title={meta.label}>{meta.short}</span>
        {s.parentSessionId && (
          <span className="tag gray subagent-tag" title={t.subagentTagTitle(s.parentSessionId)}>{t.subagentTagShort}</span>
        )}
        <div className="session-title" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          {showPinIcon && <Pin size={11} className="pin-mark" aria-label={t.pinnedAria} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortTitle(title, 36)}</span>
        </div>
        <div
          className="session-actions"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
        >
          <button
            type="button"
            className="session-kebab"
            aria-label={t.sessionActions}
            title={t.sessionActions}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (isMenuOpen) {
                actions.setOpenMenu('');
                actions.setMenuAnchor(null);
              } else {
                actions.setMenuAnchor(e.currentTarget);
                actions.setOpenMenu(s.id);
              }
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          {isMenuOpen && (
            <SessionMenu
              pinned={!!sm.pinned}
              archived={!!sm.archived}
              folderId={sm.folderId}
              folders={metaStore.folders}
              canDelete
              hasDeckMeta={!!metaStore.byId[s.id]}
              anchor={menuAnchor}
              actions={{
                onTogglePin: () => { actions.togglePin(s.id); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onRename: () => { actions.setDialog({ kind: 'rename', sessionId: s.id }); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onMoveToFolder: (fid) => { actions.moveToFolder(s.id, fid); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onCreateFolderAndMove: () => { actions.setDialog({ kind: 'newFolder', thenMoveSessionId: s.id }); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onEditTags: () => { actions.setDialog({ kind: 'tags', sessionId: s.id }); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onToggleArchive: () => { actions.toggleArchive(s.id); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onRemoveDeckMeta: () => { actions.performRemoveDeckMeta(s.id); actions.setOpenMenu(''); actions.setMenuAnchor(null); },
                onDelete: () => {
                  actions.setDialog({ kind: 'deleteSession', sessionId: s.id, sessionTitle: title });
                  actions.setOpenMenu('');
                  actions.setMenuAnchor(null);
                },
              }}
              onClose={() => { actions.setOpenMenu(''); actions.setMenuAnchor(null); }}
            />
          )}
        </div>
      </div>
      <div className="session-meta">
        {time && <span className="tiny">{time}</span>}
        {s.model && <span className="tiny" style={{ flex: 'unset' }}>· {s.model}</span>}
        {!!s.messageCount && <span className="tiny" style={{ flex: 'unset' }}>· {s.messageCount}{t.msgsSuffix}</span>}
        {!!s.childCount && (
          <span className="tiny session-childcount" style={{ flex: 'unset' }} title={t.subagentsCountTitle(s.childCount)}>
            · ↳ {s.childCount}{t.subagentsCountInline}
          </span>
        )}
        {folder && !showArchived && !sm.pinned && (
          <span className="tiny session-folder-tag" style={{ flex: 'unset' }} title={t.folderTitle(folder.name)}>
            <FolderIcon size={9} /> {folder.name}
          </span>
        )}
        {sm.pinned && folder && (
          <span className="tiny session-folder-tag" style={{ flex: 'unset' }} title={t.folderTitle(folder.name)}>
            <FolderIcon size={9} /> {folder.name}
          </span>
        )}
        {sm.archived && (
          <span className="tiny" style={{ flex: 'unset', color: 'var(--muted)' }}>{t.archivedTag}</span>
        )}
      </div>
      {sm.tags && sm.tags.length > 0 && (
        <div className="session-tags" aria-label={t.tagsAria}>
          {sm.tags.map((tag) => (
            <span key={tag} className="session-tag" title={`#${tag}`}>#{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionListView({
  sessionGroups, t, active, openMenu, menuAnchor, metaStore, showArchived, search,
  collapsedFolders, loading, actions,
}: {
  sessionGroups: SessionGroups;
  t: ChatT;
  active: string;
  openMenu: string;
  menuAnchor: HTMLElement | null;
  metaStore: MetaStore;
  showArchived: boolean;
  search: string;
  collapsedFolders: Record<string, boolean>;
  loading?: boolean;
  actions: SessionListActions;
}) {
  const renderItem = (s: LocalSession) => renderSessionItem({
    s, t, active, openMenu, menuAnchor, metaStore, showArchived, actions,
  });
  if (loading) {
    return (
      <div className="session-list" role="status" aria-busy="true">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="session-item" aria-hidden>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span className="skel" style={{ width: 26, height: 18, borderRadius: 5, flexShrink: 0 }} />
              <span className="skel" style={{ width: `${68 - (i % 3) * 12}%`, height: 13 }} />
            </div>
            <div className="session-meta" style={{ marginTop: 8 }}>
              <span className="skel" style={{ width: `${42 + (i % 2) * 14}%`, height: 10 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="session-list" role="list">
      {sessionGroups.pinned.length > 0 && (
        <div className="session-group">
          <div className="session-group-head">
            <Pin size={11} /><span>{t.pinned}</span>
            <span className="muted tiny">{sessionGroups.pinned.length}</span>
          </div>
          {sessionGroups.pinned.map(renderItem)}
        </div>
      )}
      {sessionGroups.folderGroups.map(({ folder, sessions: list }) => {
        const collapsed = !!collapsedFolders[folder.id];
        return (
          <div key={folder.id} className={`session-group folder-group ${collapsed ? 'collapsed' : ''}`}>
            <div className="session-group-head">
              <button
                type="button"
                className="folder-toggle"
                onClick={(e) => { e.stopPropagation(); actions.toggleFolderCollapsed(folder.id); }}
                aria-label={collapsed ? t.expandFolder : t.collapseFolder}
              >
                {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              </button>
              <FolderIcon size={11} />
              <span className="folder-name" title={folder.name}>{folder.name}</span>
              <span className="muted tiny">{list.length}</span>
              <div className="folder-actions">
                <button
                  type="button"
                  className="folder-action"
                  aria-label={t.renameFolder}
                  title={t.renameFolder}
                  onClick={(e) => { e.stopPropagation(); actions.setDialog({ kind: 'renameFolder', folderId: folder.id }); }}
                >
                  <Sparkles size={11} />
                </button>
                <button
                  type="button"
                  className="folder-action"
                  aria-label={t.deleteFolder}
                  title={t.deleteFolder}
                  onClick={(e) => { e.stopPropagation(); actions.applyDeleteFolder(folder.id); }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            {!collapsed && list.map(renderItem)}
            {!collapsed && list.length === 0 && (
              <div className="session-group-empty muted tiny">{t.emptyFolder}</div>
            )}
          </div>
        );
      })}
      {sessionGroups.unfoldered.length > 0 && (
        <div className="session-group">
          {(sessionGroups.pinned.length > 0 || sessionGroups.folderGroups.length > 0) && (
            <div className="session-group-head">
              <Inbox size={11} /><span>{t.unfiled}</span>
              <span className="muted tiny">{sessionGroups.unfoldered.length}</span>
            </div>
          )}
          {sessionGroups.unfoldered.map(renderItem)}
        </div>
      )}
      {!!sessionGroups.truncated && sessionGroups.truncated > 0 && (
        <div className="session-group-empty muted tiny">
          {t.truncatedHint(sessionGroups.truncated)}
        </div>
      )}
      {sessionGroups.pinned.length === 0
        && sessionGroups.folderGroups.every((g) => g.sessions.length === 0)
        && sessionGroups.unfoldered.length === 0
        && (
          <div className="session-empty">
            <span className="muted small">
              {showArchived ? t.noArchived : (search ? t.noMatchingSessions : t.noSessionsYetSidebar)}
            </span>
          </div>
        )}
    </div>
  );
}

export function SourceFilterPopover({
  t, sourceCounts, enabledSources, enabledSourceSet, sourceFilterActive,
  sourceFilterOpen, showSubagents, subagentCount,
  setEnabledSources, setShowSubagents, setSourceFilterOpen,
}: {
  t: ChatT;
  sourceCounts: Map<string, number>;
  enabledSources: string[] | null;
  enabledSourceSet: Set<string> | null;
  sourceFilterActive: boolean;
  sourceFilterOpen: boolean;
  showSubagents: boolean;
  subagentCount: number;
  setEnabledSources: React.Dispatch<React.SetStateAction<string[] | null>>;
  setShowSubagents: (next: boolean) => void;
  setSourceFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const knownSources = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1]);
  const totalCount = knownSources.reduce((acc, [, n]) => acc + n, 0);
  const checked = (key: string) => !enabledSourceSet || enabledSourceSet.has(key);
  const toggle = (key: string) => {
    setEnabledSources((cur) => {
      const base = cur ?? knownSources.map(([k]) => k);
      const has = base.includes(key);
      const next = has ? base.filter((k) => k !== key) : [...base, key];
      // Treat "all enabled" as no filter — keeps semantics clean.
      if (next.length === knownSources.length) return null;
      return next;
    });
  };
  return (
    <>
      <button
        type="button"
        className={`sessions-source-toggle ${sourceFilterActive ? 'active' : ''}`}
        aria-label={sourceFilterActive ? t.filterBySourceN(enabledSources?.length || 0) : t.filterBySource}
        title={t.filterBySource}
        onClick={() => setSourceFilterOpen((v) => !v)}
      >
        <ListFilter size={12} />
        {sourceFilterActive && (
          <span className="filter-badge">{enabledSources?.length ?? 0}</span>
        )}
      </button>
      {sourceFilterOpen && (
        <div className="source-filter-pop" role="dialog" aria-label={t.filterBySource}>
          <div className="source-filter-head">
            <b>{t.sourceFilterTitle}</b>
            <span className="muted tiny">{totalCount}{t.sessionsCountSuffix}</span>
          </div>
          <label className={`source-filter-row toggle ${showSubagents ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={showSubagents}
              onChange={(e) => setShowSubagents(e.target.checked)}
            />
            <span className="source-filter-name">{t.showSubagents}</span>
            <span className="muted tiny">{subagentCount}</span>
          </label>
          <div className="source-filter-divider" />
          <div className="source-filter-list">
            {knownSources.length === 0 && (
              <div className="muted tiny" style={{ padding: 6 }}>{t.noSessionsYet}</div>
            )}
            {knownSources.map(([key, count]) => {
              const meta = sourceMeta(key);
              const on = checked(key);
              return (
                <label key={key} className={`source-filter-row ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(key)} />
                  <span className={`tag ${meta.tone}`}>{meta.short}</span>
                  <span className="source-filter-name">{meta.label}</span>
                  <span className="muted tiny">{count}</span>
                </label>
              );
            })}
          </div>
          <div className="source-filter-foot">
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setEnabledSources(['api_server'])}
              disabled={!sourceCounts.has('api_server')}
            >{t.webOnly}</button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setEnabledSources(null)}
            >{t.sourceAll}</button>
          </div>
        </div>
      )}
    </>
  );
}
