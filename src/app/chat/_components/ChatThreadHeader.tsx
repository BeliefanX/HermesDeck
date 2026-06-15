'use client';
import { ChevronLeft, Plus, Square, Wrench } from 'lucide-react';
import { Btn, Tag } from '@/components/Brand';
import type { ChatT } from '../_lib/i18n';
import { iconBtnStyle } from './InlineParts';

export function ChatThreadHeader({
  t, busy, showToolDetails, activeTitle,
  responseLinked, abortRef, onBack, setShowToolDetails, newChat,
}: {
  t: ChatT;
  busy: boolean;
  showToolDetails: boolean;
  activeTitle: string;
  responseLinked: boolean;
  abortRef: React.RefObject<AbortController | null>;
  onBack: () => void;
  setShowToolDetails: (updater: (v: boolean) => boolean) => void;
  newChat: () => void;
}) {
  return (
    <div
      className="panel-header chat-thread-header"
      style={{
        // padding-top picks up the iOS notch / status-bar safe-area on
        // mobile PWA via the --safe-top variable (0 on desktop).
        padding: 'calc(12px + var(--safe-top)) 16px 12px',
        borderBottom: '1px solid var(--hairline)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexShrink: 0,
        minHeight: 'calc(56px + var(--safe-top))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {/* Mobile-only back button — returns to the level-1 session list
           (hidden on desktop via CSS, where the sessions panel is always up). */}
        <button
          className="btn icon sm panel-collapse chat-mobile-only"
          onClick={onBack}
          aria-label={t.back}
          title={t.back}
        >
          <ChevronLeft size={16} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 620, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeTitle || t.newChat}
          </h2>
          {responseLinked && (
            <div style={{ marginTop: 2, display: 'flex', alignItems: 'center' }}>
              <span title={t.hermesLinkedTitle}>
                <Tag variant="green">{t.hermesLinked}</Tag>
              </span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {busy ? (
          <Btn size="sm" icon={<Square size={11} />} onClick={() => abortRef.current?.abort()}>{t.stop}</Btn>
        ) : null}
        <button
          type="button"
          onClick={() => setShowToolDetails((v) => !v)}
          aria-label={showToolDetails ? t.hideToolCalls : t.showToolCalls}
          title={showToolDetails ? t.hideToolCallsTitle : t.showToolCallsTitle}
          aria-pressed={showToolDetails}
          style={{
            ...iconBtnStyle,
            background: showToolDetails ? 'var(--strong-text)' : 'var(--panel-2)',
            color: showToolDetails ? 'var(--bg)' : 'var(--text)',
            borderColor: showToolDetails ? 'var(--accent-border)' : 'var(--line)',
          }}
        >
          <Wrench size={13} />
        </button>
        <button
          type="button"
          onClick={newChat}
          aria-label={t.newChatBtn}
          title={t.newChatBtn}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'var(--hit-icon)',
            height: 'var(--hit-icon)',
            borderRadius: 8,
            background: 'var(--strong-text)',
            color: 'var(--bg)',
            border: '1px solid var(--strong-text)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background var(--t-2) var(--ease), border-color var(--t-2) var(--ease), color var(--t-2) var(--ease), transform var(--t-1) var(--ease)',
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
