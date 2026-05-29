'use client';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowDown, ChevronLeft, ChevronRight,
  FolderPlus, Upload, Wrench, X,
} from 'lucide-react';
import type { DeckMessage, DeckSession, ToolSummary } from '@/lib/types';
import { Btn } from '@/components/Brand';
import { AttachmentLightbox } from '@/components/AttachmentLightbox';
import {
  type AttachmentItem,
} from '@/lib/attachments';
import { type SlashCommand } from '@/lib/prompts';
import type { TurnUsage } from '../_lib/context-window';
import type { ChatT } from '../_lib/i18n';
import { TabBtn, iconBtnStyle } from './InlineParts';
import { ChatThreadHeader } from './ChatThreadHeader';
import { ChatComposer } from './ChatComposer';
import { ChatMessageRow } from './MessageRow';
import { EmptyState } from './EmptyState';
import { TimelinePanel } from './TimelinePanel';
import { MobileChatList } from './MobileChatList';
import type { DialogState } from './Dialogs';
import type { ReasoningEffort } from '../_hooks/useChatModels';
import type { UseGoalAndQueueResult } from '../_hooks/useGoalAndQueue';
import { useResizablePanel } from '../_hooks/useResizablePanel';

interface ChatLayoutViewProps {
  t: ChatT;
  // Chat state
  busy: boolean;
  error: string;
  input: string;
  active: string;
  activeTitle: string;
  profile: string;
  sessions: DeckSession[];
  activeMessages: DeckMessage[];
  visibleMessages: DeckMessage[];
  hiddenToolCount: number;
  responseIds: Record<string, string>;
  toolNameByCallId: Map<string, string>;
  attachments: AttachmentItem[];
  pasteHint: string;
  dragActive: boolean;
  // Layout
  showSessions: boolean;
  showTimeline: boolean;
  showArchived: boolean;
  showToolDetails: boolean;
  search: string;
  // Models / reasoning (composer)
  modelOptions: Array<{ id: string; provider: string; isDefault?: boolean }>;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  defaultReasoning: ReasoningEffort;
  reasoningLevels: ReasoningEffort[];
  reasoningTouchedRef: React.MutableRefObject<boolean>;
  // Slash menu
  slashRange: { start: number; end: number; query: string } | null;
  slashCommands: SlashCommand[];
  slashIdx: number;
  // Tools / context window
  tools: ToolSummary[];
  /** Token usage for the active session's latest turn — drives the context panel. */
  contextUsage?: TurnUsage;
  // Refs
  abortRef: React.RefObject<AbortController | null>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  stickToBottomRef: React.MutableRefObject<boolean>;
  showJumpToBottom: boolean;
  scrollToBottom: (smooth?: boolean) => void;
  // Pre-rendered children
  SessionList: React.ReactNode;
  sourceFilter: React.ReactNode;
  dialogNode: React.ReactNode;
  // Image preview state
  previewImage: { src: string; name?: string } | null;
  setPreviewImage: (v: { src: string; name?: string } | null) => void;
  onPreviewImage: (src: string, name?: string) => void;
  // Suggestions for empty state
  SUGGESTIONS: string[];
  // Setters
  setShowSessions: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTimeline: React.Dispatch<React.SetStateAction<boolean>>;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  setShowToolDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setDialog: (d: DialogState | null) => void;
  setSlashIdx: React.Dispatch<React.SetStateAction<number>>;
  setSlashRange: (r: { start: number; end: number; query: string } | null) => void;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  setSelectedModel: (v: string) => void;
  setReasoningEffort: (v: ReasoningEffort) => void;
  // Actions
  newChat: () => void;
  /** Mobile level-2 → level-1: return from the thread to the session list. */
  onBack: () => void;
  send: (override?: string) => void | Promise<void>;
  regenerateStable: () => void;
  goalAndQueue: UseGoalAndQueueResult;
  removeAttachment: (id: string) => void;
  addFiles: (files: File[]) => Promise<void>;
  flashPasteHint: (msg: string) => void;
  applySlashCommand: (cmd: SlashCommand) => void;
  handleInputChange: (value: string, caret: number) => void;
}

export function ChatLayoutView(p: ChatLayoutViewProps) {
  const sessionsPanel = useResizablePanel({
    side: 'left',
    storageKey: 'hermesdeck.chat.sessions.width.v1',
    defaultW: 248, minW: 200, maxW: 480,
  });
  const contextPanel = useResizablePanel({
    side: 'right',
    storageKey: 'hermesdeck.chat.context.width.v1',
    defaultW: 280, minW: 240, maxW: 560,
  });
  const isDesktop = sessionsPanel.isDesktop;
  const dragging = sessionsPanel.dragging || contextPanel.dragging;
  // Inline overrides only apply at desktop width where the resizers are live.
  // On tablet/mobile the @media-query widths must win, and when a panel is
  // collapsed the .no-sessions / .no-timeline rule's 0 must win.
  const wrapStyle: React.CSSProperties | undefined = (() => {
    if (!isDesktop) return undefined;
    const s: Record<string, string> = {};
    if (p.showSessions) s['--sessions-w'] = `${sessionsPanel.width}px`;
    if (p.showTimeline) s['--right-w'] = `${contextPanel.width}px`;
    return Object.keys(s).length ? (s as React.CSSProperties) : undefined;
  })();
  return (
    <div className="page-chat" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Profile switcher lives in the global AppShell chip — no topbar-slot
          duplicate here. The slot is intentionally left empty for future
          chat-only quick actions. */}
      {p.dragActive && (
        <div className="dropzone-overlay" aria-hidden>
          <div
            className="dropzone-card"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--accent-border)',
              borderRadius: 14,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            <Upload size={28} style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)' }}>{p.t.dropToAttach}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.t.dropHint}</div>
          </div>
        </div>
      )}
      <div
        className={`chat-layout-wrap ${!p.showSessions ? 'no-sessions' : ''} ${!p.showTimeline ? 'no-timeline' : ''} ${dragging ? 'resizing' : ''}`}
        style={wrapStyle}
      >
        <button
          type="button"
          className={`edge-toggle edge-left ${p.showSessions ? 'on' : 'off'}`}
          onClick={() => p.setShowSessions((v) => !v)}
          aria-label={p.showSessions ? p.t.collapseSessions : p.t.expandSessions}
          title={p.showSessions ? p.t.collapseSessions : p.t.expandSessions}
        >
          {p.showSessions ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className={`edge-toggle edge-right ${p.showTimeline ? 'on' : 'off'}`}
          onClick={() => p.setShowTimeline((v) => !v)}
          aria-label={p.showTimeline ? p.t.collapseTimeline : p.t.expandTimeline}
          title={p.showTimeline ? p.t.collapseTimeline : p.t.expandTimeline}
        >
          {p.showTimeline ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        {isDesktop && p.showSessions && (
          <div
            className={`session-resizer ${sessionsPanel.dragging ? 'dragging' : ''}`}
            onMouseDown={sessionsPanel.startResize}
            onKeyDown={sessionsPanel.onResizerKeyDown}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={sessionsPanel.width}
            aria-valuemin={sessionsPanel.minW}
            aria-valuemax={sessionsPanel.maxW}
            aria-label={p.t.resizeSessions}
            title={p.t.resizeSessions}
            tabIndex={0}
          />
        )}
        {isDesktop && p.showTimeline && (
          <div
            className={`timeline-resizer ${contextPanel.dragging ? 'dragging' : ''}`}
            onMouseDown={contextPanel.startResize}
            onKeyDown={contextPanel.onResizerKeyDown}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={contextPanel.width}
            aria-valuemin={contextPanel.minW}
            aria-valuemax={contextPanel.maxW}
            aria-label={p.t.resizeContext}
            title={p.t.resizeContext}
            tabIndex={0}
          />
        )}
      <div className={`chat-layout ${!p.showSessions ? 'no-sessions' : ''} ${!p.showTimeline ? 'no-timeline' : ''}`}>
        {/* Sessions panel (desktop) */}
        <aside
          className="chat-panel thread sessions-panel"
        >
          <div className="sessions-toolbar" style={{ padding: '10px 12px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sessions-tabs" role="tablist" aria-label={p.t.tabAll} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <TabBtn active={!p.showArchived} onClick={() => p.setShowArchived(false)}>{p.t.tabAll}</TabBtn>
              <TabBtn active={p.showArchived} onClick={() => p.setShowArchived(true)} icon={p.showArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}>
                {p.t.tabArchived}
              </TabBtn>
              <button
                className="sessions-folder-add"
                onClick={() => p.setDialog({ kind: 'newFolder' })}
                aria-label={p.t.newFolder}
                title={p.t.newFolder}
                type="button"
                style={iconBtnStyle}
              >
                <FolderPlus size={12} />
              </button>
              <div className="sessions-source-wrap" style={{ position: 'relative', marginLeft: 'auto' }}>{p.sourceFilter}</div>
            </div>
          </div>
          <div className="panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {p.SessionList}
          </div>
        </aside>

        {/* Thread */}
        <section
          className="chat-panel thread"
        >
          <ChatThreadHeader
            t={p.t}
            busy={p.busy}
            showToolDetails={p.showToolDetails}
            activeTitle={p.activeTitle}
            responseLinked={!!p.responseIds[p.active]}
            abortRef={p.abortRef}
            onBack={p.onBack}
            setShowToolDetails={p.setShowToolDetails}
            newChat={p.newChat}
          />

          <div className="messages" ref={p.messagesRef}>
            {p.activeMessages.length === 0 && (
              <EmptyState t={p.t} suggestions={p.SUGGESTIONS} onSendSuggestion={(s) => p.send(s)} />
            )}
            {!p.showToolDetails && p.hiddenToolCount > 0 && (
              <div
                className="tool-hidden-bar"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 8,
                  marginBottom: 14,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.hiddenToolCount}{p.t.hiddenSuffix}</span>
                <Btn size="sm" icon={<Wrench size={11} />} onClick={() => p.setShowToolDetails(true)}>{p.t.show}</Btn>
              </div>
            )}
            {(() => {
              const hasUserMessage = p.visibleMessages.some((x) => x.role === 'user');
              return p.visibleMessages.map((m, idx) => {
                const isLast = idx === p.visibleMessages.length - 1;
                const resolvedToolName = m.role === 'tool'
                  ? (m.toolName || (m.toolCallId ? p.toolNameByCallId.get(m.toolCallId) : undefined))
                  : undefined;
                return (
                  <ChatMessageRow
                    key={m.id}
                    m={m}
                    isLast={isLast}
                    busy={p.busy}
                    hasUserMessage={hasUserMessage}
                    resolvedToolName={resolvedToolName}
                    attachmentsAria={p.t.attachmentsAria}
                    onRegenerate={p.regenerateStable}
                    onPreviewImage={p.onPreviewImage}
                  />
                );
              });
            })()}
            {p.error && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: 12,
                  background: 'rgba(239,68,68,.06)',
                  border: '1px solid rgba(239,68,68,.36)',
                  borderRadius: 10,
                  marginBottom: 14,
                }}
              >
                <AlertTriangle size={16} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>{p.t.requestFailed}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{p.error}</div>
                </div>
                <button
                  onClick={() => p.setError('')}
                  aria-label={p.t.dismissError}
                  style={{ ...iconBtnStyle, height: 24, width: 24, padding: 0, flexShrink: 0 }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {p.showJumpToBottom && (
              <button
                className="scroll-to-bottom"
                onClick={() => { p.stickToBottomRef.current = true; p.scrollToBottom(true); }}
                aria-label={p.t.scrollToLatest}
                style={{
                  position: 'absolute',
                  bottom: 110,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 999,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  color: 'var(--muted)',
                  fontSize: 11.5,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-pop)',
                  zIndex: 4,
                }}
              >
                <ArrowDown size={12} /> {p.t.jumpToLatest}
              </button>
            )}
          </div>

          <ChatComposer
            t={p.t}
            busy={p.busy}
            input={p.input}
            attachments={p.attachments}
            taRef={p.taRef}
            fileInputRef={p.fileInputRef}
            slashRange={p.slashRange}
            slashCommands={p.slashCommands}
            slashIdx={p.slashIdx}
            pasteHint={p.pasteHint}
            modelOptions={p.modelOptions}
            selectedModel={p.selectedModel}
            reasoningEffort={p.reasoningEffort}
            defaultReasoning={p.defaultReasoning}
            reasoningLevels={p.reasoningLevels}
            reasoningTouchedRef={p.reasoningTouchedRef}
            setSlashIdx={p.setSlashIdx}
            setSlashRange={p.setSlashRange}
            setAttachments={p.setAttachments}
            setSelectedModel={p.setSelectedModel}
            setReasoningEffort={p.setReasoningEffort}
            removeAttachment={p.removeAttachment}
            addFiles={p.addFiles}
            flashPasteHint={p.flashPasteHint}
            applySlashCommand={p.applySlashCommand}
            handleInputChange={p.handleInputChange}
            send={p.send}
            goalAndQueue={p.goalAndQueue}
          />
        </section>

        {/* Context window (desktop) */}
        <TimelinePanel
          profile={p.profile}
          activeSession={p.sessions.find((x) => x.id === p.active)}
          activeMessages={p.activeMessages}
          tools={p.tools}
          responseId={p.responseIds[p.active]}
          usage={p.contextUsage ?? null}
        />
      </div>
      </div>

      {/* Mobile level-1: the session list as a full page. CSS gates this vs.
          the .chat-layout-wrap thread view via html[data-chat-mobile-view]. */}
      <MobileChatList
        t={p.t}
        search={p.search}
        showArchived={p.showArchived}
        sessionList={p.SessionList}
        sourceFilter={p.sourceFilter}
        setSearch={p.setSearch}
        setShowArchived={p.setShowArchived}
        setDialog={p.setDialog}
        newChat={p.newChat}
      />
      {p.dialogNode}
      {p.previewImage && (
        <AttachmentLightbox
          src={p.previewImage.src}
          name={p.previewImage.name}
          onClose={() => p.setPreviewImage(null)}
        />
      )}
    </div>
  );
}
