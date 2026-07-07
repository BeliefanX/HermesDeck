'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deckApi, ApiError } from '@/lib/api';
import type { DeckMessage, ToolSummary } from '@/lib/types';
import { useActiveProfile } from '@/lib/profile-context';
import type { TimelineItem } from '@/lib/timeline';
import { shortTitle } from '@/lib/format';
import { type AttachmentItem } from '@/lib/attachments';
import { type MetaStore, emptyStore, gcMetaStore, loadMetaStore, mergeServerMetaPreservingLocalGoals, saveMetaStore, serverBackedMetaStore } from '@/lib/session-meta';
import { useChatT } from './_lib/i18n';
import { type LocalSession, mergeSessions } from './_lib/storage';
import type { TurnUsage } from './_lib/context-window';
import { ChatDialogs, type DialogState } from './_components/Dialogs';
import { SessionListView, SourceFilterPopover } from './_components/SessionsSidebar';
import { ChatLayoutView } from './_components/ChatLayoutView';
import { useChatGroups } from './_hooks/useChatGroups';
import { useSessionMetaActions } from './_hooks/useSessionMetaActions';
import { useChatStream } from './_hooks/useChatStream';
import { useGoalAndQueue } from './_hooks/useGoalAndQueue';
import { useChatModels } from './_hooks/useChatModels';
import { useChatHydration } from './_hooks/useChatHydration';
import { useChatScroll } from './_hooks/useChatScroll';
import { useDragDropPaste } from './_hooks/useDragDropPaste';
import { useSlashCommand } from './_hooks/useSlashCommand';
import { useVisibleMessages } from './_hooks/useVisibleMessages';
import { NoAssignedAgentsState } from '@/components/NoAssignedAgentsState';

function apiErrorDetail(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    const detail = body && typeof body === 'object' && 'detail' in body && typeof (body as { detail?: unknown }).detail === 'string'
      ? `: ${(body as { detail: string }).detail}`
      : '';
    return `${err.status} ${err.message}${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function messagesEqual(a: DeckMessage[] | undefined, b: DeckMessage[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const t = useChatT();
  const searchParams = useSearchParams();
  // Depend on the actual string fields, not the surrounding `t` object
  // (which may be a fresh reference per render). Otherwise the SUGGESTIONS
  // array gets a new identity every render and EmptyState never benefits
  // from reference stability.
  const SUGGESTIONS = useMemo(
    () => [t.suggestion1, t.suggestion2, t.suggestion3],
    [t.suggestion1, t.suggestion2, t.suggestion3],
  );
  // Active profile is now sourced from the global ProfileContext — see
  // src/lib/profile-context.tsx. The chip in AppShell drives the switch; this
  // page simply consumes the value and refetches per-profile data.
  const { activeProfile: profile, profiles, hydrated: profileHydrated } = useActiveProfile();
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [active, setActive] = useState<string>('');
  const [messages, setMessages] = useState<Record<string, DeckMessage[]>>({});
  const messagesBySessionRef = useRef(messages);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [responseIds, setResponseIds] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string>('');
  const [showSessions, setShowSessions] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);

  // Per-turn overrides surfaced in the composer. Both are forwarded to the
  // Hermes /v1/responses endpoint via the chat-stream BFF.
  const {
    modelOptions, selectedModel, setSelectedModel, setObservedModel,
    reasoningEffort, setReasoningEffort,
    defaultReasoning, reasoningLevels, reasoningTouchedRef,
  } = useChatModels(profile);

  // Run timeline — still aggregated by useChatStream for its own delta
  // bookkeeping, but no longer rendered (the side panel shows the context
  // window breakdown instead).
  const [, setTimeline] = useState<TimelineItem[]>([]);

  // Token usage from each session's latest completed turn, keyed by session id.
  // Powers the context-window breakdown panel.
  const [usageBySession, setUsageBySession] = useState<Record<string, TurnUsage>>({});

  const abortRef = useRef<AbortController | null>(null);
  const draftPollInFlightRef = useRef(false);
  const mobileThreadPushedRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attachments — persisted across renders but never to localStorage (file
  // contents are too large and the user is unlikely to want a 20MB PDF
  // sticking around in their browser storage).
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  // Full-screen image preview overlay.
  const [previewImage, setPreviewImage] = useState<{ src: string; name?: string } | null>(null);
  const onPreviewImage = useCallback((src: string, name?: string) => setPreviewImage({ src, name }), []);
  const { dragActive, pasteHint, addFiles, removeAttachment, flashPasteHint } = useDragDropPaste(setAttachments);

  // Session organization — folders, pin, tags, archive, custom titles. Server
  // metadata is profile/user scoped; localStorage is only a cache/legacy import.
  const [metaStore, setMetaStoreRaw] = useState<MetaStore>(emptyStore());
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [openMenu, setOpenMenu] = useState<string>(''); // sessionId of open kebab menu
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const legacyMetaImportRef = useRef<Record<string, boolean>>({});

  // Source filter — null means "no filter applied", an array means
  // "only sessions whose source is in this list". Persisted to localStorage.
  const [enabledSources, setEnabledSources] = useState<string[] | null>(null);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  // Subagent (child) sessions are noisy by default — Hermes spawns one per
  // tool delegation. Hide them in the top-level list unless the user opts in.
  const [showSubagents, setShowSubagents] = useState(false);
  // Tool/subagent invocation messages clutter the conversation thread with
  // raw JSON. Off by default — turn on to debug the agent's reasoning.
  const [showToolDetails, setShowToolDetails] = useState(false);

  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Slash command palette wired below once newChat / regenerate exist.

  // updateMeta / setMetaStore + session meta actions are wired further below.
  useChatHydration({
    profile, profileHydrated,
    hydrated, setHydrated,
    setSessions, setMessages, setResponseIds, setActive,
    setShowSessions, setShowTimeline,
    setEnabledSources, setShowSubagents, setShowToolDetails, setMetaStoreRaw,
    showSessions, showTimeline, enabledSources, showSubagents, showToolDetails,
    sessions, messages, responseIds, active,
  });

  // Close source filter popover on outside click / Escape
  useEffect(() => {
    if (!sourceFilterOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.source-filter-pop, .sessions-source-toggle')) return;
      setSourceFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSourceFilterOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [sourceFilterOpen]);

  useEffect(() => {
    // Profile list is owned by ProfileContext now; just hydrate tools here.
    if (!profile) {
      setTools([]);
      return;
    }
    deckApi.tools(profile).then((r) => setTools(r.tools)).catch(() => {});
  }, [profile]);

  useEffect(() => {
    if (!hydrated || !profile) return;
    let alive = true;
    setSessionsLoading(true);
    deckApi.sessions(profile)
      .then((r) => {
        if (!alive) return;
        setSessions((prev) => mergeSessions(prev, r.sessions, profile));
        const serverMeta = r.metaStore;
        if (serverMeta) {
          const serverHasMeta = Object.keys(serverMeta.byId || {}).length > 0 || (serverMeta.folders || []).length > 0;
          const importKey = `${profile}`;
          if (!serverHasMeta && !legacyMetaImportRef.current[importKey]) {
            legacyMetaImportRef.current[importKey] = true;
            const legacy = loadMetaStore();
            const legacyGc = gcMetaStore(legacy, r.sessions.map((s) => s.id));
            const legacyHasMeta = Object.keys(legacyGc.byId || {}).length > 0 || (legacyGc.folders || []).length > 0;
            if (legacyHasMeta) {
              setMetaStoreRaw(legacyGc);
              saveMetaStore(legacyGc);
              deckApi.saveSessionMeta(profile, serverBackedMetaStore(legacyGc)).catch((err) => {
                if (alive) setError(`Session metadata import failed: ${apiErrorDetail(err)}`);
              });
              return;
            }
          }
          const serverNext = gcMetaStore(serverMeta, r.sessions.map((s) => s.id));
          setMetaStoreRaw((cur) => {
            const local = Object.keys(cur.byId || {}).length > 0 || (cur.folders || []).length > 0 ? cur : loadMetaStore();
            const next = mergeServerMetaPreservingLocalGoals(serverNext, local);
            saveMetaStore(next);
            return next;
          });
          return;
        }
        // Legacy fallback for older BFF responses: GC local cache entries for
        // sessions the server no longer returns.
        setMetaStoreRaw((cur) => {
          const next = gcMetaStore(cur, r.sessions.map((s) => s.id));
          saveMetaStore(next);
          return next;
        });
      })
      .catch((err) => {
        if (!alive) return;
        setError(`Session list failed to load: ${apiErrorDetail(err)}`);
      })
      .finally(() => {
        if (alive) setSessionsLoading(false);
      });
    return () => { alive = false; };
  }, [profile, hydrated, setMetaStoreRaw]);

  const activeMessages = messages[active] || [];
  const hasActiveServerDraft = activeMessages.some((m) => (
    m.role === 'assistant' && m.metadata?.projectionStatus === 'draft'
  ));
  const activeSession = useMemo(() => sessions.find((s) => s.id === active), [sessions, active]);

  useEffect(() => {
    messagesBySessionRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!hydrated || !profile || !active) return;
    let alive = true;
    const cached = messagesBySessionRef.current[active];
    setMessagesLoading(!cached?.length);
    deckApi.messages(active, profile)
      .then((r) => {
        if (!alive || !r.messages.length) return;
        setMessages((m) => {
          if (messagesEqual(m[active], r.messages)) return m;
          return { ...m, [active]: r.messages };
        });
      })
      .catch((err) => {
        if (alive) setError(`Messages failed to load: ${apiErrorDetail(err)}`);
      })
      .finally(() => {
        if (alive) setMessagesLoading(false);
      });
    return () => { alive = false; };
  }, [active, hydrated, profile, setMessages]);

  useEffect(() => {
    if (!hydrated || !profile || !active || busy) return;
    if (!hasActiveServerDraft) return;
    let cancelled = false;
    const poll = async () => {
      if (draftPollInFlightRef.current) return;
      draftPollInFlightRef.current = true;
      try {
        const r = await deckApi.messages(active, profile);
        if (!cancelled && r.messages.length) {
          setMessages((m) => {
            if (messagesEqual(m[active], r.messages)) return m;
            return { ...m, [active]: r.messages };
          });
        }
      } catch {
        // Keep the server-side draft visible; the next interval may succeed.
      } finally {
        draftPollInFlightRef.current = false;
      }
    };
    const id = window.setInterval(poll, 3000);
    void poll();
    return () => { cancelled = true; window.clearInterval(id); };
  }, [active, busy, hasActiveServerDraft, hydrated, profile, setMessages]);

  useEffect(() => {
    if (!hydrated || !activeSession?.model) return;
    setObservedModel(activeSession.model, activeSession.source || 'session');
  }, [activeSession, hydrated, setObservedModel]);

  const { toolNameByCallId, visibleMessages, hiddenToolCount } = useVisibleMessages(
    activeMessages, showToolDetails, busy,
  );

  const { messagesRef, stickToBottomRef, showJumpToBottom, scrollToBottom, settleToBottom } = useChatScroll({
    active, activeMessages, input, taRef,
  });

  const activeTitle = useMemo(
    () => shortTitle(activeSession?.title, 60),
    [activeSession],
  );

  const {
    pushTimeline, clearTimeline, handleEvent,
    openSession, send, newChat, regenerate, regenerateStable,
  } = useChatStream({
    profile, active, messages, responseIds, busy, input, attachments,
    selectedModel, reasoningEffort, defaultReasoning, hydrated,
    setSessions, setMessages, setResponseIds, setActive,
    setBusy, setError, setInput, setAttachments, setTimeline, setMessagesLoading,
    setUsage: setUsageBySession,
    abortRef, taRef, stickToBottomRef, t,
  });
  void regenerate; // kept for potential future refs; UI uses regenerateStable

  // ─── Mobile two-level navigation ──────────────────────────────────────
  // On phones the chat is two pages: a level-1 session list and a level-2
  // thread. We flip a <html> data-attr (like the existing data-composer-focus)
  // and let CSS gate the two views plus the app-bar and bottom-nav chrome.
  // Desktop ignores the attr and keeps all 3 panels.
  //
  // Entering the thread also pushes a history entry, so the platform back
  // gesture (iOS PWA edge-swipe, Android back) and the header back button all
  // pop thread → list, instead of escaping the chat feature to the prior route.
  const applyMobileView = useCallback((v: 'list' | 'thread') => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.chatMobileView = v;
    }
  }, []);

  const explicitSessionParam = searchParams.get('session');

  useEffect(() => {
    // A plain /chat visit is the mobile level-1 entry point. Do not let a
    // stale html[data-chat-mobile-view="thread"] from an earlier in-app visit,
    // HMR cycle, or browser restore make the Chat tab reopen directly into the
    // persisted active thread. Only an explicit ?session= deep link below may
    // choose the level-2 thread on initial entry.
    if (!explicitSessionParam) {
      applyMobileView('list');
      mobileThreadPushedRef.current = false;
    }
  }, [explicitSessionParam, applyMobileView]);

  const enterThread = useCallback(() => {
    // Desktop shows all 3 panels — no level split, so no history entry.
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width:880px)').matches) return;
    if (document.documentElement.dataset.chatMobileView === 'thread') return;
    applyMobileView('thread');
    try {
      window.history.pushState(null, '', window.location.href);
      mobileThreadPushedRef.current = true;
    } catch {
      mobileThreadPushedRef.current = false;
    }
  }, [applyMobileView]);

  // Back button → pop the pushed entry; the popstate handler then flips to the
  // list, so the button and the OS back gesture take the exact same path.
  const goToList = useCallback(() => {
    if (typeof document !== 'undefined'
      && document.documentElement.dataset.chatMobileView === 'thread') {
      if (mobileThreadPushedRef.current) {
        window.history.back();
      } else {
        applyMobileView('list');
      }
    }
  }, [applyMobileView]);

  useEffect(() => {
    const onPopState = () => {
      if (document.documentElement.dataset.chatMobileView === 'thread') {
        applyMobileView('list');
        mobileThreadPushedRef.current = false;
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.chatMobileView;
      }
    };
  }, [applyMobileView]);

  // Opening a session or starting a new chat promotes the thread to level-2.
  const openSessionMobile = useCallback((s: LocalSession) => {
    openSession(s);
    enterThread();
    settleToBottom();
  }, [openSession, enterThread, settleToBottom]);
  const newChatMobile = useCallback(() => {
    newChat();
    enterThread();
  }, [newChat, enterThread]);

  // Honour /chat?session=<id> deep links (dashboard rows, run detail, command
  // palette all link here). The persisted `active` from localStorage is the
  // default; an explicit ?session= param wins once that id shows up in the
  // freshly-loaded session list.
  const deepLinkAppliedRef = useRef('');
  useEffect(() => {
    if (!hydrated) return;
    const target = explicitSessionParam;
    const key = `${profile}:${target || ''}`;
    if (deepLinkAppliedRef.current === key) return;
    if (!target) { deepLinkAppliedRef.current = key; return; }
    const found = sessions.find((s) => s.id === target);
    if (found) {
      deepLinkAppliedRef.current = key;
      if (found.id !== active) openSession(found);
      // A deep link is an explicit request for one session — land in the
      // level-2 thread directly rather than the level-1 list.
      enterThread();
    } else if (sessions.length > 0) {
      // Session list loaded but the id isn't among it — fall back to the
      // level-1 list instead of leaving a stale thread attr in control.
      deepLinkAppliedRef.current = key;
      applyMobileView('list');
      mobileThreadPushedRef.current = false;
    }
  }, [hydrated, sessions, explicitSessionParam, openSession, enterThread, active, profile, applyMobileView]);

  const {
    updateMeta, setMetaStore,
    performRemoveDeckMeta, performDeleteSession,
    togglePin, toggleArchive, moveToFolder,
    applyRename, applyTags,
    applyNewFolder, applyRenameFolder, applyDeleteFolder,
  } = useSessionMetaActions({
    metaStore, setMetaStoreRaw, active, profile, showArchived, t,
    setSessions, setMessages, setResponseIds, setActive, setError, clearTimeline,
  });

  // Deck-side approximations of Hermes's `/goal` and `/queue` slash commands.
  // See useGoalAndQueue for the rationale (api_server doesn't expose either).
  const goalAndQueue = useGoalAndQueue({
    active, busy, metaStore, updateMeta, input, setInput, send,
  });

  const clearCurrentMessages = useCallback(() => {
    if (!active) return;
    setMessages((m) => ({ ...m, [active]: [] }));
    setResponseIds((r) => { const next = { ...r }; delete next[active]; return next; });
    setUsageBySession((u) => { const next = { ...u }; delete next[active]; return next; });
    clearTimeline();
  }, [active, clearTimeline, setMessages, setResponseIds, setUsageBySession]);

  const toggleFolderCollapsed = useCallback((id: string) => {
    setCollapsedFolders((cur) => ({ ...cur, [id]: !cur[id] }));
  }, []);

  const {
    slashRange, setSlashRange, slashIdx, setSlashIdx, slashCommands,
    handleInputChange, applySlashCommand, dispatchSlashSubmit,
  } = useSlashCommand({
    input, setInput, taRef, abortRef, newChat, clearCurrentMessages, regenerate,
    modelOptions, setSelectedModel,
    reasoningLevels, defaultReasoning, reasoningTouchedRef, setReasoningEffort,
    setError,
  });

  const sendFromComposer = useCallback(() => {
    if (dispatchSlashSubmit()) return;
    return goalAndQueue.sendWithGoal();
  }, [dispatchSlashSubmit, goalAndQueue]);

  // ─── Sidebar grouping ─────────────────────────────────────────────────
  const { sourceCounts, sourceFilterActive, enabledSourceSet, sessionGroups, subagentCount } = useChatGroups({
    sessions, metaStore, search, showArchived, enabledSources, showSubagents,
  });

  // openSession / togglePin / toggleArchive are NOT stable references — they
  // close over `active`, `messages` and `metaStore`. An empty dep array froze
  // the first-render versions, so a session click ran a stale openSession
  // (active='', messages={}) that never aborted the prior stream and always
  // refetched, and pin/archive toggled off a stale metaStore.
  const sessionListActions = useMemo(() => ({
    openSession: openSessionMobile,
    togglePin,
    toggleArchive,
    moveToFolder,
    toggleFolderCollapsed,
    applyDeleteFolder,
    performRemoveDeckMeta,
    setDialog,
    setOpenMenu,
    setMenuAnchor,
  }), [
    openSessionMobile, togglePin, toggleArchive, moveToFolder, toggleFolderCollapsed,
    applyDeleteFolder, performRemoveDeckMeta,
  ]);

  const SessionList = (
    <SessionListView
      sessionGroups={sessionGroups}
      t={t}
      active={active}
      openMenu={openMenu}
      menuAnchor={menuAnchor}
      metaStore={metaStore}
      showArchived={showArchived}
      search={search}
      collapsedFolders={collapsedFolders}
      loading={!profileHydrated || (!!profile && (!hydrated || sessionsLoading))}
      actions={sessionListActions}
    />
  );

  // ─── Source filter popover ────────────────────────────────────────────
  // Reused in the desktop sessions toolbar and the mobile sheet.
  const renderSourceFilter = () => (
    <SourceFilterPopover
      t={t}
      sourceCounts={sourceCounts}
      enabledSources={enabledSources}
      enabledSourceSet={enabledSourceSet}
      sourceFilterActive={sourceFilterActive}
      sourceFilterOpen={sourceFilterOpen}
      showSubagents={showSubagents}
      subagentCount={subagentCount}
      setEnabledSources={setEnabledSources}
      setShowSubagents={setShowSubagents}
      setSourceFilterOpen={setSourceFilterOpen}
    />
  );


  // ─── Dialog rendering helpers ─────────────────────────────────────────
  const dialogNode = (
    <ChatDialogs
      dialog={dialog}
      setDialog={setDialog}
      sessions={sessions}
      messages={messages}
      metaStore={metaStore}
      profile={profile}
      t={t}
      applyRename={applyRename}
      applyTags={applyTags}
      applyNewFolder={applyNewFolder}
      applyRenameFolder={applyRenameFolder}
      performDeleteSession={performDeleteSession}
    />
  );

  // Admin/super_admin may have an emergency active profile when the Hermes
  // catalog endpoint is unavailable; do not misclassify that as unassigned.
  const noAssignedAgents = profileHydrated && profiles.length === 0 && !profile;

  if (noAssignedAgents) {
    return (
      <main className="chat-shell" style={{ padding: 18 }}>
        <NoAssignedAgentsState />
      </main>
    );
  }

  return (
    <ChatLayoutView
      t={t}
      busy={busy}
      error={error}
      input={input}
      active={active}
      activeTitle={activeTitle}
      profile={profile}
      sessions={sessions}
      activeMessages={activeMessages}
      messagesLoading={messagesLoading}
      visibleMessages={visibleMessages}
      hiddenToolCount={hiddenToolCount}
      responseIds={responseIds}
      toolNameByCallId={toolNameByCallId}
      attachments={attachments}
      pasteHint={pasteHint}
      dragActive={dragActive}
      showSessions={showSessions}
      showTimeline={showTimeline}
      showArchived={showArchived}
      showToolDetails={showToolDetails}
      search={search}
      modelOptions={modelOptions}
      selectedModel={selectedModel}
      reasoningEffort={reasoningEffort}
      defaultReasoning={defaultReasoning}
      reasoningLevels={reasoningLevels}
      reasoningTouchedRef={reasoningTouchedRef}
      slashRange={slashRange}
      slashCommands={slashCommands}
      slashIdx={slashIdx}
      tools={tools}
      contextUsage={usageBySession[active]}
      abortRef={abortRef}
      taRef={taRef}
      fileInputRef={fileInputRef}
      messagesRef={messagesRef}
      stickToBottomRef={stickToBottomRef}
      showJumpToBottom={showJumpToBottom}
      scrollToBottom={scrollToBottom}
      SessionList={SessionList}
      sourceFilter={renderSourceFilter()}
      dialogNode={dialogNode}
      previewImage={previewImage}
      setPreviewImage={setPreviewImage}
      onPreviewImage={onPreviewImage}
      SUGGESTIONS={SUGGESTIONS}
      setShowSessions={setShowSessions}
      setShowTimeline={setShowTimeline}
      setShowArchived={setShowArchived}
      setShowToolDetails={setShowToolDetails}
      setSearch={setSearch}
      setError={setError}
      setDialog={setDialog}
      setSlashIdx={setSlashIdx}
      setSlashRange={setSlashRange}
      setAttachments={setAttachments}
      setSelectedModel={setSelectedModel}
      setReasoningEffort={setReasoningEffort}
      newChat={newChatMobile}
      onBack={goToList}
      send={sendFromComposer}
      regenerateStable={regenerateStable}
      goalAndQueue={goalAndQueue}
      removeAttachment={removeAttachment}
      addFiles={addFiles}
      flashPasteHint={flashPasteHint}
      applySlashCommand={applySlashCommand}
      handleInputChange={handleInputChange}
    />
  );
}
