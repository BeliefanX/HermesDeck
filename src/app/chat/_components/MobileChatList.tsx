'use client';
import { Archive, ArchiveRestore, FolderPlus, Plus, Search } from 'lucide-react';
import type { ChatT } from '../_lib/i18n';
import type { DialogState } from './Dialogs';
import { TabBtn, iconBtnStyle } from './InlineParts';

/**
 * Level-1 chat page on mobile: the session list rendered as a full page. The
 * restored global app-bar sits above it (title + profile switcher); tapping a
 * row or "New" promotes the thread to the level-2 view via the page's
 * mobileView controller.
 */
export function MobileChatList({
  t, search, showArchived, sessionList, sourceFilter,
  setSearch, setShowArchived, setDialog, newChat,
}: {
  t: ChatT;
  search: string;
  showArchived: boolean;
  sessionList: React.ReactNode;
  sourceFilter: React.ReactNode;
  setSearch: (v: string) => void;
  setShowArchived: (v: boolean) => void;
  setDialog: (d: DialogState | null) => void;
  newChat: () => void;
}) {
  return (
    <div className="chat-mobile-list">
      <div className="chat-mobile-list-toolbar">
        <div className="chat-mobile-list-row">
          <div
            className="input-group sessions-search"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              padding: '0 12px',
              background: 'var(--bg-soft)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-3)',
            }}
          >
            <Search size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
            <input
              placeholder={showArchived ? t.searchArchived : t.searchSessions}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t.searchSessions}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>
          <button
            type="button"
            className="chat-mobile-newbtn"
            onClick={newChat}
            aria-label={t.newChatBtn}
          >
            <Plus size={15} />
            <span>{t.newBtn}</span>
          </button>
        </div>
        <div
          className="sessions-tabs"
          role="tablist"
          style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <TabBtn active={!showArchived} onClick={() => setShowArchived(false)}>{t.tabAll}</TabBtn>
          <TabBtn
            active={showArchived}
            onClick={() => setShowArchived(true)}
            icon={showArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
          >
            {t.tabArchived}
          </TabBtn>
          <button
            className="sessions-folder-add"
            onClick={() => setDialog({ kind: 'newFolder' })}
            aria-label={t.newFolder}
            title={t.newFolder}
            type="button"
            style={iconBtnStyle}
          >
            <FolderPlus size={12} />
          </button>
          <div className="sessions-source-wrap" style={{ position: 'relative', marginLeft: 'auto' }}>
            {sourceFilter}
          </div>
        </div>
      </div>
      <div className="chat-mobile-list-body">
        {sessionList}
      </div>
    </div>
  );
}
