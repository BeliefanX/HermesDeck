'use client';
import { X } from 'lucide-react';
import type { DeckMessage, DeckSession } from '@/lib/types';
import { Btn, Kicker } from '@/components/Brand';
import { InlineDialog } from '@/components/InlineDialog';
import { effectiveTitle, getMeta, type MetaStore } from '@/lib/session-meta';
import { shortTitle } from '@/lib/format';
import type { ChatT } from '../_lib/i18n';
import { iconBtnStyle } from './InlineParts';

export type DialogState =
  | { kind: 'rename'; sessionId: string }
  | { kind: 'tags'; sessionId: string }
  | { kind: 'newFolder'; thenMoveSessionId?: string }
  | { kind: 'renameFolder'; folderId: string }
  | { kind: 'deleteSession'; sessionId: string; sessionTitle: string };

export function ChatDialogs({
  dialog, setDialog, sessions, messages, metaStore, profile, t,
  applyRename, applyTags, applyNewFolder, applyRenameFolder, performDeleteSession,
}: {
  dialog: DialogState | null;
  setDialog: (d: DialogState | null) => void;
  sessions: DeckSession[];
  messages: Record<string, DeckMessage[]>;
  metaStore: MetaStore;
  profile: string;
  t: ChatT;
  applyRename: (sessionId: string, value: string) => void;
  applyTags: (sessionId: string, value: string) => void;
  applyNewFolder: (name: string, thenMoveSessionId?: string) => void;
  applyRenameFolder: (folderId: string, name: string) => void;
  performDeleteSession: (sessionId: string) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === 'rename') {
    const s = sessions.find((x) => x.id === dialog.sessionId);
    const sm = getMeta(metaStore, dialog.sessionId);
    return (
      <InlineDialog
        title={t.dlgRenameTitle}
        description={t.dlgRenameDesc}
        initialValue={effectiveTitle(sm, s?.title)}
        placeholder={t.newChat}
        confirmLabel={t.dlgRenameConfirm}
        onConfirm={(v) => { applyRename(dialog.sessionId, v); setDialog(null); }}
        onCancel={() => setDialog(null)}
        helper={t.dlgRenameHelper}
      />
    );
  }
  if (dialog.kind === 'tags') {
    const sm = getMeta(metaStore, dialog.sessionId);
    return (
      <InlineDialog
        title={t.dlgTagsTitle}
        description={t.dlgTagsDesc}
        initialValue={(sm.tags || []).join(', ')}
        placeholder={t.dlgTagsPh}
        confirmLabel={t.dlgTagsConfirm}
        onConfirm={(v) => { applyTags(dialog.sessionId, v); setDialog(null); }}
        onCancel={() => setDialog(null)}
        helper={t.dlgTagsHelper}
      />
    );
  }
  if (dialog.kind === 'newFolder') {
    return (
      <InlineDialog
        title={t.dlgNewFolderTitle}
        initialValue=""
        placeholder={t.dlgNewFolderPh}
        confirmLabel={t.dlgNewFolderConfirm}
        onConfirm={(v) => {
          const name = v.trim();
          if (!name) { setDialog(null); return; }
          applyNewFolder(name, dialog.thenMoveSessionId);
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
    );
  }
  if (dialog.kind === 'renameFolder') {
    const folder = metaStore.folders.find((f) => f.id === dialog.folderId);
    return (
      <InlineDialog
        title={t.dlgRenameFolderTitle}
        initialValue={folder?.name || ''}
        confirmLabel={t.dlgRenameFolderConfirm}
        onConfirm={(v) => { applyRenameFolder(dialog.folderId, v); setDialog(null); }}
        onCancel={() => setDialog(null)}
      />
    );
  }
  if (dialog.kind === 'deleteSession') {
    const sid = dialog.sessionId;
    const title = dialog.sessionTitle;
    const sess = sessions.find((x) => x.id === sid);
    const localCount = (messages[sid] || []).length;
    const remoteCount = sess?.messageCount || 0;
    const msgCount = Math.max(localCount, remoteCount);
    return (
      <div
        className="dialog-backdrop"
        onClick={() => setDialog(null)}
        role="dialog"
        aria-modal="true"
        aria-label={t.dlgDeleteAria}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          background: 'color-mix(in oklch, var(--strong-text) 18%, transparent)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div
          className="dialog-card"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-pop)',
            padding: 18,
            maxWidth: 480,
            width: '100%',
          }}
        >
          <div className="dialog-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Kicker style={{ marginBottom: 4 }}>{t.dlgDeleteKicker}</Kicker>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--strong-text)', letterSpacing: '-.02em' }}>{t.dlgDeleteTitle}</h3>
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                {t.dlgDeleteBodyPrefix} <b>{msgCount}</b>{t.dlgDeleteBodySuffix.startsWith(' ') ? '' : ' '}{t.dlgDeleteBodySuffix} <b>{t.dlgDeleteBodyIrreversible}</b>
              </div>
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface-bg)', border: '1px solid var(--hairline)', borderRadius: 8, display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, fontSize: 11.5 }}>
                <span style={{ color: 'var(--muted-2)' }}>{t.dlgFieldTitle}</span>
                <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>{shortTitle(title, 60)}</span>
                <span style={{ color: 'var(--muted-2)' }}>{t.dlgFieldProfile}</span>
                <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{profile}</span>
                <span style={{ color: 'var(--muted-2)' }}>{t.dlgFieldSessionId}</span>
                <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{sid}</span>
                <span style={{ color: 'var(--muted-2)' }}>{t.dlgFieldMessages}</span>
                <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{msgCount}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>
                {t.dlgDeleteHint} <b>{t.dlgDeleteHintBold}</b>
              </div>
            </div>
            <button onClick={() => setDialog(null)} aria-label={t.dlgClose} style={iconBtnStyle}>
              <X size={14} />
            </button>
          </div>
          <div className="dialog-actions" style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn size="sm" onClick={() => setDialog(null)}>{t.dlgCancel}</Btn>
            <Btn
              size="sm"
              variant="danger"
              onClick={() => {
                setDialog(null);
                performDeleteSession(sid);
              }}
            >
              {t.dlgConfirmDelete}
            </Btn>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
