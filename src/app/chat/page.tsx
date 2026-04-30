'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deckApi } from '@/lib/api';
import { streamChat } from '@/lib/client-sse';
import type { DeckAttachment, DeckMessage, DeckProfile, DeckSession } from '@/lib/types';
import { interpret, type TimelineItem } from '@/lib/timeline';
import { sourceMeta, shortTitle, relTime } from '@/lib/format';
import { MessageContent } from '@/components/MessageContent';
import { MessageActions } from '@/components/MessageActions';
import { AttachmentChip } from '@/components/AttachmentChip';
import { SlashCommandMenu } from '@/components/SlashCommandMenu';
import { SessionMenu } from '@/components/SessionMenu';
import { InlineDialog } from '@/components/InlineDialog';
import {
  type AttachmentItem,
  attachmentToPayload,
  ingestFile,
  ingestPastedText,
  SMART_PASTE_THRESHOLD,
} from '@/lib/attachments';
import {
  BUILTIN_COMMANDS,
  type SlashCommand,
  applyPromptTemplate,
  extractSlashQuery,
  filterCommands,
} from '@/lib/prompts';
import {
  type MetaStore,
  type Folder,
  addFolder,
  deleteFolder,
  effectiveTitle,
  emptyStore,
  getMeta,
  loadMetaStore,
  normalizeTags,
  renameFolder,
  saveMetaStore,
  setMeta,
} from '@/lib/session-meta';
import {
  Plus, Square, Send, Sparkles, MessageSquare, X, AlertTriangle, Layers,
  Wrench, Activity, CheckCircle2, AlertCircle, Radio, ArrowDown, Paperclip, Upload,
  Search, Pin, Folder as FolderIcon, FolderPlus, ChevronDown, ChevronLeft, ChevronRight,
  MoreHorizontal, Archive, ArchiveRestore, Inbox, ListFilter, Bot, Network,
} from 'lucide-react';
import { Card, Kicker, Tag, Btn, Kbd } from '@/components/Brand';

// Tool names that spawn or interact with a Hermes subagent. Visually distinct
// from regular tool calls so they're easy to find in long conversations.
const SUBAGENT_TOOLS = new Set(['delegate_task']);
const isSubagentTool = (name?: string) => !!(name && SUBAGENT_TOOLS.has(name));

const PANELS_KEY = 'hermesdeck.chat.panels.v1';
const SOURCE_FILTER_KEY = 'hermesdeck.chat.sourcefilter.v1';
const SHOW_SUBAGENTS_KEY = 'hermesdeck.chat.show-subagents.v1';
const SHOW_TOOL_DETAILS_KEY = 'hermesdeck.chat.show-tool-details.v1';

type LocalSession = DeckSession;
type PersistedChatState = {
  sessions: LocalSession[];
  messages: Record<string, DeckMessage[]>;
  responseIds: Record<string, string>;
  active?: string;
  profile?: string;
};

const STORAGE_KEY = 'hermesdeck.chat.v1';
const SUGGESTIONS = [
  'Summarize what HermesDeck can do right now',
  'List the active profile’s model and toolsets',
  'Draft a README description for this session',
];

function safeParseStored(): PersistedChatState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedChatState;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}

// One-time migration: drop legacy `local:` placeholder/draft sessions that lived
// only in browser storage. Backed sessions all have UUID-style IDs now.
function stripLegacyLocal(state: PersistedChatState): PersistedChatState {
  const sessions = (state.sessions || []).filter((s) => s.id && !s.id.startsWith('local:'));
  const messages: Record<string, DeckMessage[]> = {};
  for (const [id, list] of Object.entries(state.messages || {})) {
    if (!id.startsWith('local:')) messages[id] = list;
  }
  const responseIds: Record<string, string> = {};
  for (const [id, val] of Object.entries(state.responseIds || {})) {
    if (!id.startsWith('local:')) responseIds[id] = val;
  }
  const active = state.active && !state.active.startsWith('local:') ? state.active : undefined;
  return { sessions, messages, responseIds, active, profile: state.profile };
}

// Merge cached + remote, preferring remote field values (title/messageCount may
// have moved server-side since the cache snapshot). Order: pinned/folder logic
// is applied later — here we just present remote-first by updatedAt.
function mergeSessions(cached: LocalSession[], remote: DeckSession[]): LocalSession[] {
  const remoteIds = new Set(remote.map((s) => s.id));
  const cachedExtra = cached.filter((s) => !remoteIds.has(s.id));
  return [...remote, ...cachedExtra];
}

function genSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: time-based id, valid as a session_id (matches /^[A-Za-z0-9_.-]+$/)
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function ChatPage() {
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [profile, setProfile] = useState('default');
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [active, setActive] = useState<string>('');
  const [messages, setMessages] = useState<Record<string, DeckMessage[]>>({});
  const [responseIds, setResponseIds] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string>('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [showSessions, setShowSessions] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);

  // Run timeline (categorized + delta aggregated)
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const deltaRef = useRef<{ item: TimelineItem; lastTs: number } | null>(null);

  // Auto-scroll
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attachments — persisted across renders but never to localStorage (file
  // contents are too large and the user is unlikely to want a 20MB PDF
  // sticking around in their browser storage).
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [pasteHint, setPasteHint] = useState<string>('');
  const dragCounterRef = useRef(0);
  const pasteHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session organization — folders, pin, tags, archive, custom titles. All of
  // it is local-only metadata keyed by Hermes session id.
  const [metaStore, setMetaStoreRaw] = useState<MetaStore>(emptyStore());
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [openMenu, setOpenMenu] = useState<string>(''); // sessionId of open kebab menu
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

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

  type DialogState =
    | { kind: 'rename'; sessionId: string }
    | { kind: 'tags'; sessionId: string }
    | { kind: 'newFolder'; thenMoveSessionId?: string }
    | { kind: 'renameFolder'; folderId: string }
    | { kind: 'deleteSession'; sessionId: string; sessionTitle: string };
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Slash command palette state — driven entirely from input + caret.
  const [slashRange, setSlashRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const slashCommands = useMemo(
    () => slashRange ? filterCommands(BUILTIN_COMMANDS, slashRange.query) : [],
    [slashRange],
  );
  // Reset highlight when the filtered list shrinks past it.
  useEffect(() => {
    if (slashIdx >= slashCommands.length) setSlashIdx(0);
  }, [slashCommands.length, slashIdx]);

  const updateMeta = useCallback((sessionId: string, patch: Partial<ReturnType<typeof getMeta>>) => {
    setMetaStoreRaw((cur) => {
      const next = setMeta(cur, sessionId, patch);
      saveMetaStore(next);
      return next;
    });
  }, []);

  const setMetaStore = useCallback((updater: (cur: MetaStore) => MetaStore) => {
    setMetaStoreRaw((cur) => {
      const next = updater(cur);
      saveMetaStore(next);
      return next;
    });
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    // Push placeholders so the user sees "loading" chips immediately.
    const placeholders: AttachmentItem[] = files.map((f) => ({
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: f.name || 'upload',
      mime: f.type || 'application/octet-stream',
      size: f.size,
      kind: f.type.startsWith('image/') ? 'image' : 'text',
      status: 'loading',
    }));
    setAttachments((cur) => [...cur, ...placeholders]);
    const results = await Promise.all(files.map((f) => ingestFile(f)));
    setAttachments((cur) => {
      const next = [...cur];
      placeholders.forEach((ph, i) => {
        const idx = next.findIndex((x) => x.id === ph.id);
        if (idx >= 0) next[idx] = results[i];
      });
      return next;
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const flashPasteHint = useCallback((msg: string) => {
    setPasteHint(msg);
    if (pasteHintTimer.current) clearTimeout(pasteHintTimer.current);
    pasteHintTimer.current = setTimeout(() => setPasteHint(''), 3000);
  }, []);

  // Hydrate
  useEffect(() => {
    const raw = safeParseStored();
    if (raw) {
      const stored = stripLegacyLocal(raw);
      const storedProfile = stored.profile || 'default';
      setProfile(storedProfile);
      if (stored.sessions.length) setSessions(stored.sessions);
      setMessages(stored.messages);
      setResponseIds(stored.responseIds);
      if (stored.active) setActive(stored.active);
    }
    try {
      const stash = localStorage.getItem(PANELS_KEY);
      if (stash) {
        const parsed = JSON.parse(stash) as { sessions?: boolean; timeline?: boolean };
        if (typeof parsed.sessions === 'boolean') setShowSessions(parsed.sessions);
        if (typeof parsed.timeline === 'boolean') setShowTimeline(parsed.timeline);
      }
    } catch {}
    try {
      const stash = localStorage.getItem(SOURCE_FILTER_KEY);
      if (stash) {
        const parsed = JSON.parse(stash) as string[] | null;
        if (parsed === null || Array.isArray(parsed)) setEnabledSources(parsed);
      }
    } catch {}
    try {
      const stash = localStorage.getItem(SHOW_SUBAGENTS_KEY);
      if (stash === '1') setShowSubagents(true);
    } catch {}
    try {
      const stash = localStorage.getItem(SHOW_TOOL_DETAILS_KEY);
      if (stash === '1') setShowToolDetails(true);
    } catch {}
    setMetaStoreRaw(loadMetaStore());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(PANELS_KEY, JSON.stringify({ sessions: showSessions, timeline: showTimeline })); } catch {}
  }, [showSessions, showTimeline, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SOURCE_FILTER_KEY, JSON.stringify(enabledSources)); } catch {}
  }, [enabledSources, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SHOW_SUBAGENTS_KEY, showSubagents ? '1' : '0'); } catch {}
  }, [showSubagents, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SHOW_TOOL_DETAILS_KEY, showToolDetails ? '1' : '0'); } catch {}
  }, [showToolDetails, hydrated]);

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
    deckApi.profiles().then((r) => {
      setProfiles(r.profiles);
      const activeProfile = r.profiles.find((p) => p.active)?.id || r.profiles[0]?.id || 'default';
      if (!safeParseStored()?.profile) setProfile(activeProfile);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    deckApi.sessions(profile)
      .then((r) => setSessions((prev) => mergeSessions(prev, r.sessions)))
      .catch(() => {});
  }, [profile, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // Cache only sessions that have something interesting (any messages or
    // metadata). Avoids ballooning the snapshot with every remote session.
    const cachedSessions = sessions.filter((s) => (messages[s.id]?.length || 0) > 0);
    const storedMessages = Object.fromEntries(Object.entries(messages).filter(([, list]) => list.length > 0));
    const payload: PersistedChatState = { sessions: cachedSessions, messages: storedMessages, responseIds, active, profile };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }, [sessions, messages, responseIds, active, profile, hydrated]);

  const activeMessages = messages[active] || [];

  // Two-stage filter:
  //   1) Default-noise rules — hide tool / system / session_meta / compaction
  //      handoff rows unless the user opts into tool-detail mode.
  //   2) Render-emptiness check — drop any row that would render to literally
  //      nothing (no text, no tool_calls to expand, no attachments, not a
  //      role='tool' summary header). Applied in BOTH modes — there's no
  //      universe where an empty ghost bubble is useful UX.
  // Special case: keep the trailing empty assistant during `busy` — that's
  // the live streaming target so the typing dots can animate into it.
  // Map call_id -> tool_name from assistant tool_call rows. Lets us surface
  // the originating tool name on `role='tool'` result rows (whose own
  // `tool_name` column is usually NULL in Hermes' DB).
  const toolNameByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of activeMessages) {
      if (!m.toolCalls?.length) continue;
      for (const c of m.toolCalls) {
        if (c.id && c.name) map.set(c.id, c.name);
      }
    }
    return map;
  }, [activeMessages]);

  const visibleMessages = useMemo(() => {
    return activeMessages.filter((m, idx) => {
      const hasText = !!(m.content && m.content.trim());
      const hasToolCalls = (m.toolCalls?.length || 0) > 0;
      const hasAttachments = (m.attachments?.length || 0) > 0;
      const isStreamingTarget =
        busy && idx === activeMessages.length - 1 && m.role === 'assistant' && !hasToolCalls;

      if (!showToolDetails) {
        if (m.role === 'tool' || m.role === 'system' || m.role === 'session_meta') return false;
        if (m.role === 'assistant' && !hasText && hasToolCalls) return false;
        if (m.role === 'assistant' && m.content && m.content.startsWith('[CONTEXT COMPACTION')) return false;
      }

      // Renders nothing in any mode (tool-result rows still render a header
      // even with empty content, so they're exempt).
      if (!hasText && !hasToolCalls && !hasAttachments && m.role !== 'tool') {
        return isStreamingTarget;
      }
      return true;
    });
  }, [activeMessages, showToolDetails, busy]);
  const hiddenToolCount = activeMessages.length - visibleMessages.length;

  // Smooth auto-scroll: stick to bottom while user hasn't scrolled up.
  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Detect "user scrolled away from bottom" so we don't fight them while reading.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const near = distance < 80;
      stickToBottomRef.current = near;
      setShowJumpToBottom(!near && el.scrollHeight - el.clientHeight > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [active]);

  // Reset stick-to-bottom whenever switching sessions; jump to bottom instantly.
  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => scrollToBottom(false));
  }, [active, scrollToBottom]);

  // Smooth-follow during streaming: any time messages change AND we should
  // stick to bottom, animate to bottom on the next frame.
  const lastAssistantContent = activeMessages[activeMessages.length - 1]?.content;
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom(true));
  }, [lastAssistantContent, activeMessages.length, scrollToBottom]);

  // Auto-resize composer. Keep this in sync with .composer .textarea max-height
  // in globals.css — overshooting CSS max-height makes the box clip mid-line.
  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    const cap = window.matchMedia('(max-width:880px)').matches ? 140 : 160;
    ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
  }, [input]);

  // Global drag-and-drop. Use enter/leave with a counter so flickering stops
  // when the cursor crosses child boundaries inside the chat layout.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) addFiles(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  // Cleanup paste-hint timer on unmount.
  useEffect(() => () => {
    if (pasteHintTimer.current) clearTimeout(pasteHintTimer.current);
  }, []);

  const activeTitle = useMemo(
    () => shortTitle(sessions.find((s) => s.id === active)?.title, 60),
    [sessions, active],
  );

  function pushTimeline(item: TimelineItem) {
    setTimeline((prev) => [item, ...prev].slice(0, 80));
  }

  function clearTimeline() {
    setTimeline([]);
    deltaRef.current = null;
  }

  function handleEvent(eventType: string, payload: unknown) {
    if (eventType !== 'run-event') return;
    const obj: any = payload;
    const innerType: string = obj?.type || 'event';
    const result = interpret({ type: innerType, payload: obj?.payload ?? obj, ts: obj?.ts ?? Date.now() });

    if (result.mergeDelta) {
      // Aggregate consecutive text deltas into a single live entry.
      const cur = deltaRef.current;
      if (cur && Date.now() - cur.lastTs < 60_000) {
        cur.item.count = (cur.item.count || 1) + 1;
        cur.item.summary = `${cur.item.count} text chunks`;
        cur.lastTs = Date.now();
        setTimeline((prev) => prev.map((x) => (x.id === cur.item.id ? { ...cur.item } : x)));
      } else {
        const newItem: TimelineItem = {
          id: `delta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'message',
          title: 'Streaming…',
          summary: '1 text chunk',
          ts: Date.now(),
          count: 1,
          raw: innerType,
        };
        deltaRef.current = { item: newItem, lastTs: Date.now() };
        pushTimeline(newItem);
      }
      return;
    }

    if (result.item) {
      // any non-delta event ends the current delta aggregation window
      deltaRef.current = null;
      pushTimeline(result.item);
    }
  }

  async function openSession(s: LocalSession) {
    setActive(s.id);
    setSessionsOpen(false);
    setError('');
    // Load remote messages on first open. We refetch even when a local cache
    // exists if the remote count is higher (mobile sees what desktop wrote).
    const cached = messages[s.id];
    if (!cached || (s.messageCount || 0) > cached.length) {
      const r = await deckApi.messages(s.id, profile).catch(() => ({ messages: [] }));
      if (r.messages.length) setMessages((m) => ({ ...m, [s.id]: r.messages }));
    }
  }

  async function send(
    textArg?: string,
    opts?: {
      skipUserMessage?: boolean;
      previousResponseIdOverride?: string | null;
      attachmentsOverride?: DeckAttachment[];
    },
  ) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    // Only ready attachments are forwarded; loading/error chips stay in the UI.
    const liveAtts = opts?.attachmentsOverride
      ?? attachments.filter((a) => a.status === 'ready').map(attachmentToPayload);
    setError('');
    if (!textArg) setInput('');
    let sid = active;
    if (!sid) {
      sid = genSessionId();
      const title = text.split('\n')[0].slice(0, 64) || 'New chat';
      const created: LocalSession = {
        id: sid, profileId: profile, title, source: 'hermesdeck', model: profile,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0,
      };
      setSessions((s) => [created, ...s.filter((x) => x.id !== sid)]);
      setMessages((m) => ({ ...m, [sid]: [] }));
      setActive(sid);
    }
    // null = explicitly start a fresh chain (used by regenerate); undefined = use stored
    const currentResponseId = opts?.previousResponseIdOverride === null
      ? undefined
      : (opts?.previousResponseIdOverride ?? responseIds[sid]);
    const skipUser = opts?.skipUserMessage === true;
    const assistantId = `a_${Date.now()}`;
    const newMessages: DeckMessage[] = skipUser
      ? [{ id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() }]
      : [
          {
            id: `u_${Date.now()}`,
            role: 'user',
            content: text,
            createdAt: new Date().toISOString(),
            ...(liveAtts.length ? { attachments: liveAtts } : {}),
          },
          { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
        ];
    setMessages((m) => ({ ...m, [sid]: [...(m[sid] || []), ...newMessages] }));
    setSessions((s) => s.map((x) => x.id === sid ? { ...x, updatedAt: new Date().toISOString(), messageCount: (x.messageCount || 0) + newMessages.length } : x));
    if (!skipUser && !opts?.attachmentsOverride) setAttachments([]);
    setBusy(true);
    clearTimeline();
    stickToBottomRef.current = true; // sending always pulls user back to bottom
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Reconcile our optimistic session_id with whatever the backend used.
      // The backend echoes its real session_id in the very first `status` event
      // (and again in `done`). We rename keys the moment we see the canonical
      // id so the localStorage cache, the active selection, and any in-flight
      // delta writes all converge on the same id — even if the user refreshes
      // mid-stream, hydration + remote fetch will line up.
      const reconcileSid = (incoming: string) => {
        if (!incoming || incoming === sid) return;
        const old = sid;
        sid = incoming; // closure-local update so subsequent setMessages target the right key
        setSessions((list) => {
          const has = list.some((x) => x.id === incoming);
          if (has) return list.filter((x) => x.id !== old);
          return list.map((x) => x.id === old ? { ...x, id: incoming } : x);
        });
        setMessages((m) => {
          if (!m[old]) return m;
          const { [old]: moved, ...rest } = m;
          return { ...rest, [incoming]: rest[incoming] ?? moved };
        });
        setResponseIds((r) => {
          if (!r[old]) return r;
          const { [old]: moved, ...rest } = r;
          return { ...rest, [incoming]: moved };
        });
        // Always switch active to the incoming id when we owned the optimistic
        // one — guards against a stale `active === old` snapshot from React.
        setActive((cur) => cur === old ? incoming : cur);
      };

      await streamChat(
        {
          message: text,
          profileId: profile,
          sessionId: sid,
          previousResponseId: currentResponseId,
          attachments: liveAtts,
          timeoutMs: 180000,
        },
        {
          onStatus(phase, data) {
            const obj = (typeof data === 'object' && data) ? (data as Record<string, unknown>) : {};
            const incoming = obj.sessionId ? String(obj.sessionId) : '';
            if (incoming) reconcileSid(incoming);
            const item = interpret({ type: `status.${phase}`, ts: Date.now() }).item;
            if (item) { deltaRef.current = null; pushTimeline(item); }
          },
          onDelta(delta) {
            setMessages((m) => ({ ...m, [sid]: (m[sid] || []).map((x) => x.id === assistantId ? { ...x, content: x.content + delta } : x) }));
          },
          onEvent(type, payload) { handleEvent(type, payload); },
          onDone(data) {
            const obj = (typeof data === 'object' && data) ? (data as Record<string, unknown>) : {};
            const responseId = obj.responseId ? String(obj.responseId) : '';
            const confirmedSid = obj.sessionId ? String(obj.sessionId) : '';
            if (confirmedSid) reconcileSid(confirmedSid);
            if (responseId) setResponseIds((r) => ({ ...r, [sid]: responseId }));
            const item = interpret({ type: 'run.completed', payload: data, ts: Date.now() }).item;
            if (item) { deltaRef.current = null; pushTimeline(item); }
          },
          onError(message) {
            setError(message);
            setMessages((m) => ({ ...m, [sid]: (m[sid] || []).map((x) => x.id === assistantId ? { ...x, content: x.content + (x.content ? '\n\n' : '') + `[Error] ${message}` } : x) }));
            const item = interpret({ type: 'error', payload: { error: message }, ts: Date.now() }).item;
            if (item) { deltaRef.current = null; pushTimeline(item); }
          },
        },
        ac.signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!ac.signal.aborted) setError(msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function newChat() {
    setActive('');
    setSessionsOpen(false);
    setError('');
    clearTimeline();
    setTimeout(() => taRef.current?.focus(), 60);
  }

  async function regenerate() {
    if (busy) return;
    const sid = active;
    const list = messages[sid] || [];
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUser = list[lastUserIdx];
    const userText = lastUser.content;
    if (!userText.trim()) return;
    // Drop everything after the last user message; keep the user message
    setMessages((m) => ({ ...m, [sid]: (m[sid] || []).slice(0, lastUserIdx + 1) }));
    // Reset chain so the new turn doesn't link back to the discarded assistant
    setResponseIds((r) => { const next = { ...r }; delete next[sid]; return next; });
    setError('');
    await send(userText, {
      skipUserMessage: true,
      previousResponseIdOverride: null,
      attachmentsOverride: lastUser.attachments || [],
    });
  }

  async function performDeleteSession(id: string) {
    if (!id) return;
    // Optimistic: clear from UI immediately so the click feels responsive,
    // then call the backend. If the DB delete fails the toast surfaces it
    // but we keep the UI clean — the orphan entry would just reappear on
    // next refresh, which is the right signal.
    setSessions((s) => s.filter((x) => x.id !== id));
    setMessages((m) => { const next = { ...m }; delete next[id]; return next; });
    setResponseIds((r) => { const next = { ...r }; delete next[id]; return next; });
    setMetaStore((cur) => {
      if (!cur.byId[id]) return cur;
      const byId = { ...cur.byId };
      delete byId[id];
      return { ...cur, byId };
    });
    if (active === id) setActive('');
    try {
      await deckApi.deleteSession(id, profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Delete failed: ${msg}`);
    }
  }

  function clearCurrentMessages() {
    if (!active) return;
    setMessages((m) => ({ ...m, [active]: [] }));
    setResponseIds((r) => { const next = { ...r }; delete next[active]; return next; });
    clearTimeline();
  }

  function toggleFolderCollapsed(id: string) {
    setCollapsedFolders((cur) => ({ ...cur, [id]: !cur[id] }));
  }

  // ─── Slash command handling ───────────────────────────────────────────
  function handleInputChange(value: string, caret: number) {
    setInput(value);
    const range = extractSlashQuery(value, caret);
    setSlashRange(range);
  }

  function applySlashCommand(cmd: SlashCommand) {
    if (!slashRange) {
      // Action commands fired without an open palette — also valid path.
      if (cmd.kind === 'action') runSlashAction(cmd.action);
      setSlashRange(null);
      return;
    }
    if (cmd.kind === 'action') {
      // Strip the slash token and fire the action.
      const before = input.slice(0, slashRange.start);
      const after = input.slice(slashRange.end);
      const next = (before + after).replace(/^\s+/, '');
      setInput(next);
      setSlashRange(null);
      runSlashAction(cmd.action);
      return;
    }
    const { text: nextText, caret } = applyPromptTemplate(
      input, slashRange.start, slashRange.end, cmd.template, cmd.cursorMarker,
    );
    setInput(nextText);
    setSlashRange(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch {}
    });
  }

  function runSlashAction(action: 'new' | 'clear' | 'regen' | 'stop') {
    switch (action) {
      case 'new': newChat(); break;
      case 'clear': clearCurrentMessages(); break;
      case 'regen': regenerate(); break;
      case 'stop': abortRef.current?.abort(); break;
    }
  }

  // ─── Session metadata actions ─────────────────────────────────────────
  function togglePin(sessionId: string) {
    const meta = getMeta(metaStore, sessionId);
    updateMeta(sessionId, { pinned: !meta.pinned });
  }

  function toggleArchive(sessionId: string) {
    const meta = getMeta(metaStore, sessionId);
    if (meta.archived) {
      updateMeta(sessionId, { archived: false, archivedAt: undefined });
    } else {
      updateMeta(sessionId, { archived: true, archivedAt: new Date().toISOString() });
      // Switch away if the archived one was active — archive view is hidden by default.
      if (active === sessionId && !showArchived) setActive('');
    }
  }

  function moveToFolder(sessionId: string, folderId: string | null) {
    updateMeta(sessionId, { folderId: folderId ?? undefined });
  }

  function applyRename(sessionId: string, value: string) {
    const trimmed = value.trim();
    updateMeta(sessionId, { customTitle: trimmed || undefined });
  }

  function applyTags(sessionId: string, value: string) {
    const tags = normalizeTags(value);
    updateMeta(sessionId, { tags: tags.length ? tags : undefined });
  }

  function applyNewFolder(name: string, thenMoveSessionId?: string) {
    setMetaStore((cur) => {
      const { store, folder } = addFolder(cur, name);
      if (thenMoveSessionId) {
        return setMeta(store, thenMoveSessionId, { folderId: folder.id });
      }
      return store;
    });
  }

  function applyRenameFolder(folderId: string, name: string) {
    if (!name.trim()) return;
    setMetaStore((cur) => renameFolder(cur, folderId, name));
  }

  function applyDeleteFolder(folderId: string) {
    setMetaStore((cur) => deleteFolder(cur, folderId));
  }

  // ─── Sidebar grouping ─────────────────────────────────────────────────
  // Available sources (with counts) — derived from current session list. Used
  // both for filtering and for rendering the filter popover with usage counts.
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const k = (s.source || 'hermes').toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [sessions]);

  const sourceFilterActive = enabledSources !== null;
  const enabledSourceSet = useMemo(
    () => enabledSources ? new Set(enabledSources) : null,
    [enabledSources],
  );

  const sessionGroups = useMemo(() => {
    const cap = 80;
    const real = sessions.slice(0, cap);

    const rawQ = search.trim().toLowerCase();
    // Treat `#foo` as a tag-only query — strip the marker before comparing.
    const tagQ = rawQ.startsWith('#') ? rawQ.slice(1) : rawQ;
    const tagOnly = rawQ.startsWith('#');
    const q = rawQ;
    const matches = (s: LocalSession) => {
      const meta = getMeta(metaStore, s.id);
      const tagHit = (meta.tags || []).some((t) => t.toLowerCase().includes(tagQ));
      if (tagOnly) return tagHit;
      const title = effectiveTitle(meta, s.title).toLowerCase();
      if (title.includes(q)) return true;
      return tagHit;
    };

    const filtered = real.filter((s) => {
      const meta = getMeta(metaStore, s.id);
      if (showArchived ? !meta.archived : !!meta.archived) return false;
      if (q && !matches(s)) return false;
      if (enabledSourceSet && !enabledSourceSet.has((s.source || 'hermes').toLowerCase())) return false;
      if (!showSubagents && s.parentSessionId) return false;
      return true;
    });

    if (showArchived) {
      return {
        pinned: [] as LocalSession[],
        folderGroups: [] as { folder: Folder; sessions: LocalSession[] }[],
        unfoldered: filtered,
      };
    }

    const pinned = filtered.filter((s) => getMeta(metaStore, s.id).pinned);
    const rest = filtered.filter((s) => !getMeta(metaStore, s.id).pinned);

    const folderGroups = metaStore.folders.map((folder) => ({
      folder,
      sessions: rest.filter((s) => getMeta(metaStore, s.id).folderId === folder.id),
    }));
    const knownFolderIds = new Set(metaStore.folders.map((f) => f.id));
    const unfoldered = rest.filter((s) => {
      const fid = getMeta(metaStore, s.id).folderId;
      return !fid || !knownFolderIds.has(fid);
    });

    return { pinned, folderGroups, unfoldered };
  }, [sessions, metaStore, search, showArchived, enabledSourceSet, showSubagents]);

  const subagentCount = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.parentSessionId ? 1 : 0), 0),
    [sessions],
  );

  const renderSessionItem = (s: LocalSession) => {
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
        role="listitem"
        className={`session-item ${s.id === active ? 'active' : ''}${sm.archived ? ' archived' : ''}`}
        onClick={() => openSession(s)}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpenMenu(s.id);
        }}
      >
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className={`tag ${meta.tone}`} title={meta.label}>{meta.short}</span>
          {s.parentSessionId && (
            <span className="tag gray subagent-tag" title={`Subagent · parent ${s.parentSessionId}`}>sub</span>
          )}
          <div className="session-title" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {showPinIcon && <Pin size={11} className="pin-mark" aria-label="Pinned" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortTitle(title, 36)}</span>
          </div>
          <div className="session-actions">
            <button
              type="button"
              className="session-kebab"
              aria-label="Session actions"
              title="Session actions"
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  setOpenMenu('');
                  setMenuAnchor(null);
                } else {
                  setMenuAnchor(e.currentTarget);
                  setOpenMenu(s.id);
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
                anchor={menuAnchor}
                actions={{
                  onTogglePin: () => { togglePin(s.id); setOpenMenu(''); setMenuAnchor(null); },
                  onRename: () => { setDialog({ kind: 'rename', sessionId: s.id }); setOpenMenu(''); setMenuAnchor(null); },
                  onMoveToFolder: (fid) => { moveToFolder(s.id, fid); setOpenMenu(''); setMenuAnchor(null); },
                  onCreateFolderAndMove: () => { setDialog({ kind: 'newFolder', thenMoveSessionId: s.id }); setOpenMenu(''); setMenuAnchor(null); },
                  onEditTags: () => { setDialog({ kind: 'tags', sessionId: s.id }); setOpenMenu(''); setMenuAnchor(null); },
                  onToggleArchive: () => { toggleArchive(s.id); setOpenMenu(''); setMenuAnchor(null); },
                  onDelete: () => {
                    setDialog({ kind: 'deleteSession', sessionId: s.id, sessionTitle: title });
                    setOpenMenu('');
                    setMenuAnchor(null);
                  },
                }}
                onClose={() => { setOpenMenu(''); setMenuAnchor(null); }}
              />
            )}
          </div>
        </div>
        <div className="session-meta">
          {time && <span className="tiny">{time}</span>}
          {s.model && <span className="tiny" style={{ flex: 'unset' }}>· {s.model}</span>}
          {!!s.messageCount && <span className="tiny" style={{ flex: 'unset' }}>· {s.messageCount} msgs</span>}
          {!!s.childCount && (
            <span className="tiny session-childcount" style={{ flex: 'unset' }} title={`Contains ${s.childCount} subagent sessions`}>
              · ↳ {s.childCount} subagent
            </span>
          )}
          {folder && !showArchived && !sm.pinned && (
            <span className="tiny session-folder-tag" style={{ flex: 'unset' }} title={`Folder: ${folder.name}`}>
              <FolderIcon size={9} /> {folder.name}
            </span>
          )}
          {sm.pinned && folder && (
            <span className="tiny session-folder-tag" style={{ flex: 'unset' }} title={`Folder: ${folder.name}`}>
              <FolderIcon size={9} /> {folder.name}
            </span>
          )}
          {sm.archived && (
            <span className="tiny" style={{ flex: 'unset', color: 'var(--muted)' }}>· archived</span>
          )}
        </div>
        {sm.tags && sm.tags.length > 0 && (
          <div className="session-tags" aria-label="Tags">
            {sm.tags.map((t) => (
              <span key={t} className="session-tag" title={`#${t}`}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const SessionList = (
    <div className="session-list" role="list">
      {sessionGroups.pinned.length > 0 && (
        <div className="session-group">
          <div className="session-group-head">
            <Pin size={11} /><span>Pinned</span>
            <span className="muted tiny">{sessionGroups.pinned.length}</span>
          </div>
          {sessionGroups.pinned.map(renderSessionItem)}
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
                onClick={(e) => { e.stopPropagation(); toggleFolderCollapsed(folder.id); }}
                aria-label={collapsed ? 'Expand folder' : 'Collapse folder'}
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
                  aria-label="Rename folder"
                  title="Rename folder"
                  onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'renameFolder', folderId: folder.id }); }}
                >
                  <Sparkles size={11} />
                </button>
                <button
                  type="button"
                  className="folder-action"
                  aria-label="Delete folder"
                  title="Delete folder (sessions are kept)"
                  onClick={(e) => { e.stopPropagation(); applyDeleteFolder(folder.id); }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            {!collapsed && list.map(renderSessionItem)}
            {!collapsed && list.length === 0 && (
              <div className="session-group-empty muted tiny">Empty folder</div>
            )}
          </div>
        );
      })}
      {sessionGroups.unfoldered.length > 0 && (
        <div className="session-group">
          {(sessionGroups.pinned.length > 0 || sessionGroups.folderGroups.length > 0) && (
            <div className="session-group-head">
              <Inbox size={11} /><span>Unfiled</span>
              <span className="muted tiny">{sessionGroups.unfoldered.length}</span>
            </div>
          )}
          {sessionGroups.unfoldered.map(renderSessionItem)}
        </div>
      )}
      {sessionGroups.pinned.length === 0
        && sessionGroups.folderGroups.every((g) => g.sessions.length === 0)
        && sessionGroups.unfoldered.length === 0
        && (
          <div className="session-empty">
            <span className="muted small">
              {showArchived ? 'No archived sessions' : (search ? 'No matching sessions' : 'No sessions yet')}
            </span>
          </div>
        )}
    </div>
  );

  // ─── Source filter popover ────────────────────────────────────────────
  // Reused in the desktop sessions toolbar and the mobile sheet — same
  // popover, same persistence, just rendered in two places.
  const renderSourceFilter = () => {
    const knownSources = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1]);
    const totalCount = knownSources.reduce((acc, [, n]) => acc + n, 0);
    const checked = (key: string) => !enabledSourceSet || enabledSourceSet.has(key);
    const toggle = (key: string) => {
      setEnabledSources((cur) => {
        const base = cur ?? knownSources.map(([k]) => k);
        const has = base.includes(key);
        const next = has ? base.filter((k) => k !== key) : [...base, key];
        // Treat "all enabled" as no filter — keeps semantics clean and avoids
        // the popover showing every checkbox ticked as if it were filtered.
        if (next.length === knownSources.length) return null;
        return next;
      });
    };
    return (
      <>
        <button
          type="button"
          className={`sessions-source-toggle ${sourceFilterActive ? 'active' : ''}`}
          aria-label={sourceFilterActive ? `Filter by source (${enabledSources?.length || 0} enabled)` : 'Filter by source'}
          title="Filter by source"
          onClick={() => setSourceFilterOpen((v) => !v)}
        >
          <ListFilter size={12} />
          {sourceFilterActive && (
            <span className="filter-badge">{enabledSources?.length ?? 0}</span>
          )}
        </button>
        {sourceFilterOpen && (
          <div className="source-filter-pop" role="dialog" aria-label="Filter by source">
            <div className="source-filter-head">
              <b>Filter by source</b>
              <span className="muted tiny">{totalCount} sessions</span>
            </div>
            <label className={`source-filter-row toggle ${showSubagents ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={showSubagents}
                onChange={(e) => setShowSubagents(e.target.checked)}
              />
              <span className="source-filter-name">Show subagent sessions</span>
              <span className="muted tiny">{subagentCount}</span>
            </label>
            <div className="source-filter-divider" />
            <div className="source-filter-list">
              {knownSources.length === 0 && (
                <div className="muted tiny" style={{ padding: 6 }}>No sessions yet</div>
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
              >Web only</button>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setEnabledSources(null)}
              >All</button>
            </div>
          </div>
        )}
      </>
    );
  };

  // ─── Dialog rendering helpers ─────────────────────────────────────────
  const dialogNode = (() => {
    if (!dialog) return null;
    if (dialog.kind === 'rename') {
      const s = sessions.find((x) => x.id === dialog.sessionId);
      const sm = getMeta(metaStore, dialog.sessionId);
      return (
        <InlineDialog
          title="Rename session"
          description="The custom title is shown in this Deck only — it does not sync to Hermes."
          initialValue={effectiveTitle(sm, s?.title)}
          placeholder="New chat"
          confirmLabel="Save"
          onConfirm={(v) => { applyRename(dialog.sessionId, v); setDialog(null); }}
          onCancel={() => setDialog(null)}
          helper="Leave empty to restore the original title"
        />
      );
    }
    if (dialog.kind === 'tags') {
      const sm = getMeta(metaStore, dialog.sessionId);
      return (
        <InlineDialog
          title="Edit tags"
          description="Quick identifiers for the sessions list — up to 8, comma-separated."
          initialValue={(sm.tags || []).join(', ')}
          placeholder="work, urgent, AI"
          confirmLabel="Save"
          onConfirm={(v) => { applyTags(dialog.sessionId, v); setDialog(null); }}
          onCancel={() => setDialog(null)}
          helper="Up to 24 chars per tag"
        />
      );
    }
    if (dialog.kind === 'newFolder') {
      return (
        <InlineDialog
          title="New folder"
          initialValue=""
          placeholder="Work / Personal / Research…"
          confirmLabel="Create"
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
          title="Rename folder"
          initialValue={folder?.name || ''}
          confirmLabel="Save"
          onConfirm={(v) => { applyRenameFolder(dialog.folderId, v); setDialog(null); }}
          onCancel={() => setDialog(null)}
        />
      );
    }
    if (dialog.kind === 'deleteSession') {
      const sid = dialog.sessionId;
      const title = dialog.sessionTitle;
      return (
        <div
          className="dialog-backdrop"
          onClick={() => setDialog(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Delete session"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,.55)',
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
                <Kicker style={{ marginBottom: 4 }}>DESTRUCTIVE</Kicker>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--strong-text)', letterSpacing: '-.02em' }}>Delete session</h3>
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                  This permanently deletes &ldquo;{shortTitle(title, 40)}&rdquo; and all of its messages. The matching row in Hermes&rsquo; state.db is also cleared. This cannot be undone.
                </div>
              </div>
              <button onClick={() => setDialog(null)} aria-label="Close" style={iconBtnStyle}>
                <X size={14} />
              </button>
            </div>
            <div className="dialog-actions" style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn size="sm" onClick={() => setDialog(null)}>Cancel</Btn>
              <Btn
                size="sm"
                variant="danger"
                onClick={() => {
                  setDialog(null);
                  performDeleteSession(sid);
                }}
              >
                Confirm delete
              </Btn>
            </div>
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="page-chat" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {dragActive && (
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
            <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)' }}>Drop to attach</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Images, PDF, DOCX, text and code files</div>
          </div>
        </div>
      )}
      <div className={`chat-layout-wrap ${!showSessions ? 'no-sessions' : ''} ${!showTimeline ? 'no-timeline' : ''}`}>
        <button
          type="button"
          className={`edge-toggle edge-left ${showSessions ? 'on' : 'off'}`}
          onClick={() => setShowSessions((v) => !v)}
          aria-label={showSessions ? 'Collapse sessions panel' : 'Expand sessions panel'}
          title={showSessions ? 'Collapse sessions panel' : 'Expand sessions panel'}
        >
          {showSessions ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className={`edge-toggle edge-right ${showTimeline ? 'on' : 'off'}`}
          onClick={() => setShowTimeline((v) => !v)}
          aria-label={showTimeline ? 'Collapse run timeline' : 'Expand run timeline'}
          title={showTimeline ? 'Collapse run timeline' : 'Expand run timeline'}
        >
          {showTimeline ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      <div className={`chat-layout ${!showSessions ? 'no-sessions' : ''} ${!showTimeline ? 'no-timeline' : ''}`}>
        {/* Sessions panel (desktop) */}
        <aside
          className="chat-panel sessions-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div
            className="panel-header"
            style={{
              padding: '14px 16px 12px',
              borderBottom: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <Kicker style={{ marginBottom: 4 }}>CONVERSATIONS</Kicker>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 620, color: 'var(--strong-text)', letterSpacing: '-.012em' }}>Sessions</h2>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>Synced across devices</div>
            </div>
            <Btn
              size="sm"
              variant="primary"
              icon={<Plus size={12} />}
              onClick={newChat}
            >
              New
            </Btn>
          </div>
          <div className="sessions-toolbar" style={{ padding: '10px 12px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select
              className="select"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              aria-label="Select profile"
              style={selectStyle}
            >
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? ' · active' : ''}</option>)}
            </select>
            <div
              className="input-group sessions-search"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 30,
                padding: '0 10px',
                background: 'var(--bg-soft)',
                border: '1px solid var(--line)',
                borderRadius: 8,
              }}
            >
              <Search size={12} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={showArchived ? 'Search archived…' : 'Search sessions or #tags'}
                aria-label="Search sessions"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text)',
                  fontSize: 12.5,
                  fontFamily: 'var(--font-sans)',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="sessions-tabs" role="tablist" aria-label="View" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <TabBtn active={!showArchived} onClick={() => setShowArchived(false)}>All</TabBtn>
              <TabBtn active={showArchived} onClick={() => setShowArchived(true)} icon={showArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}>
                Archived
              </TabBtn>
              <button
                className="sessions-folder-add"
                onClick={() => setDialog({ kind: 'newFolder' })}
                aria-label="New folder"
                title="New folder"
                type="button"
                style={iconBtnStyle}
              >
                <FolderPlus size={12} />
              </button>
              <div className="sessions-source-wrap" style={{ position: 'relative', marginLeft: 'auto' }}>{renderSourceFilter()}</div>
            </div>
          </div>
          <div className="panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {SessionList}
          </div>
        </aside>

        {/* Thread */}
        <section
          className="chat-panel thread"
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            className="panel-header"
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexShrink: 0,
              minHeight: 56,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {/* Mobile-only quick actions */}
              <button
                className="btn icon sm panel-collapse chat-mobile-only"
                onClick={() => setSessionsOpen(true)}
                aria-label="Sessions list"
                title="Sessions list"
                style={iconBtnStyle}
              >
                <Layers size={14} />
              </button>
              <button
                className="btn icon sm panel-collapse chat-mobile-only"
                onClick={newChat}
                aria-label="New chat"
                title="New chat"
                style={iconBtnStyle}
              >
                <Plus size={14} />
              </button>
              {!showSessions && (
                <button onClick={newChat} aria-label="New chat" title="New chat" style={iconBtnStyle}>
                  <Plus size={14} />
                </button>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 620, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeTitle || 'New chat'}
                </h2>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  profile · <Kbd>{profile}</Kbd>
                  {responseIds[active] && <Tag variant="green">linked</Tag>}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowToolDetails((v) => !v)}
                aria-label={showToolDetails ? 'Hide tool calls' : 'Show tool calls'}
                title={showToolDetails ? 'Hide tool calls / subagent internals' : 'Show tool calls / subagent internals (debug)'}
                aria-pressed={showToolDetails}
                style={{
                  ...iconBtnStyle,
                  background: showToolDetails ? 'var(--accent)' : 'var(--panel-2)',
                  color: showToolDetails ? '#08090c' : 'var(--text)',
                  borderColor: showToolDetails ? 'var(--accent-border)' : 'var(--line)',
                }}
              >
                <Wrench size={13} />
              </button>
              {busy ? (
                <Btn size="sm" icon={<Square size={11} />} onClick={() => abortRef.current?.abort()}>Stop</Btn>
              ) : (
                <Tag variant="green" icon={<Sparkles size={10} />}>ready</Tag>
              )}
            </div>
          </div>

          <div className="messages" ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 22px 8px', minHeight: 0 }}>
            {activeMessages.length === 0 && (
              <div
                className="empty-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 12,
                  padding: '48px 16px',
                  maxWidth: 560,
                  margin: '0 auto',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                  }}
                >
                  <MessageSquare size={20} />
                </div>
                <Kicker>NEW CONVERSATION</Kicker>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', letterSpacing: '-.025em' }}>
                  Start a Hermes session
                </h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 460 }}>
                  Pick a profile and send a message. HermesDeck stores sessions locally and chains follow-ups via{' '}
                  <Kbd>response_id</Kbd>.
                </p>
                <div className="suggest" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        height: 30,
                        padding: '0 12px',
                        borderRadius: 999,
                        background: 'var(--panel-2)',
                        border: '1px solid var(--line)',
                        color: 'var(--text)',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!showToolDetails && hiddenToolCount > 0 && (
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
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hiddenToolCount} tool calls / subagent internals hidden</span>
                <Btn size="sm" icon={<Wrench size={11} />} onClick={() => setShowToolDetails(true)}>Show</Btn>
              </div>
            )}
            {visibleMessages.map((m, idx) => {
              const isLast = idx === visibleMessages.length - 1;
              const isLastAssistant = isLast && m.role === 'assistant';
              const showRegenerate =
                isLastAssistant &&
                !busy &&
                !!m.content &&
                visibleMessages.some((x) => x.role === 'user');
              const showTyping = m.role === 'assistant' && !m.content && busy && !m.toolCalls?.length;
              const isTool = m.role === 'tool';
              const isToolCall = m.role === 'assistant' && (m.toolCalls?.length || 0) > 0 && !m.content;
              const resolvedToolName = isTool
                ? (m.toolName || (m.toolCallId ? toolNameByCallId.get(m.toolCallId) : undefined))
                : undefined;
              const isSubagentRow =
                (isToolCall && (m.toolCalls || []).some((c) => isSubagentTool(c.name)))
                || (isTool && isSubagentTool(resolvedToolName));
              return (
                <div
                  key={m.id}
                  className={`msg-row ${m.role}${isLastAssistant && !busy && m.content ? ' show-actions' : ''}${isTool || isToolCall ? ' is-tool' : ''}${isSubagentRow ? ' is-subagent' : ''}`}
                >
                  <div className={`msg ${m.role}${isTool || isToolCall ? ' tool' : ''}${isSubagentRow ? ' subagent' : ''}`}>
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="msg-attachments" role="list" aria-label="Attachments">
                        {m.attachments.map((a) => (
                          <AttachmentChip
                            key={a.id}
                            item={{ ...a, status: 'ready' } as AttachmentItem}
                            readOnly
                          />
                        ))}
                      </div>
                    )}
                    {isToolCall ? (
                      <ToolCallSummary calls={m.toolCalls || []} />
                    ) : isTool ? (
                      <ToolResultSummary toolName={resolvedToolName} content={m.content} />
                    ) : m.content ? (
                      <MessageContent content={m.content} />
                    ) : showTyping ? (
                      <span className="msg-typing"><span /><span /><span /></span>
                    ) : null}
                  </div>
                  {m.content && !showTyping && !isTool && !isToolCall && (
                    <MessageActions
                      content={m.content}
                      canRegenerate={showRegenerate}
                      onRegenerate={regenerate}
                      busy={busy}
                    />
                  )}
                </div>
              );
            })}
            {error && (
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>Request failed</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{error}</div>
                </div>
                <button
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                  style={{ ...iconBtnStyle, height: 24, width: 24, padding: 0, flexShrink: 0 }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {showJumpToBottom && (
              <button
                className="scroll-to-bottom"
                onClick={() => { stickToBottomRef.current = true; scrollToBottom(true); }}
                aria-label="Scroll to latest"
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
                <ArrowDown size={12} /> Jump to latest
              </button>
            )}
          </div>

          <div
            className="composer"
            style={{
              borderTop: '1px solid var(--hairline)',
              padding: '12px 16px 14px',
              background: 'var(--panel)',
              flexShrink: 0,
            }}
          >
            {attachments.length > 0 && (
              <div className="composer-atts" role="list" aria-label="Pending attachments" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} item={a} onRemove={() => removeAttachment(a.id)} />
                ))}
              </div>
            )}
            <div
              className="composer-row"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                background: 'var(--bg-soft)',
                border: '1px solid var(--line)',
                borderRadius: 12,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                accept="image/*,.pdf,.docx,.txt,.md,.markdown,.mdx,.json,.jsonc,.yaml,.yml,.toml,.ini,.env,.csv,.tsv,.log,.html,.htm,.xml,.svg,.css,.scss,.sass,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.cpp,.c,.h,.hpp,.cs,.php,.sh,.bash,.zsh,.sql,.graphql,.proto,.vue,.svelte,.astro"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) addFiles(files);
                  e.target.value = '';
                }}
              />
              <div className="composer-textarea-wrap" style={{ position: 'relative', minWidth: 0 }}>
                {slashRange && (
                  <SlashCommandMenu
                    commands={slashCommands}
                    query={slashRange.query}
                    selectedIndex={slashIdx}
                    onHover={setSlashIdx}
                    onPick={(cmd) => applySlashCommand(cmd)}
                    onClose={() => setSlashRange(null)}
                  />
                )}
                <textarea
                  ref={taRef}
                  className="textarea"
                  placeholder="Ask Hermes anything. Use / for commands…"
                  style={{
                    width: '100%',
                    resize: 'none',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 14,
                    lineHeight: 1.55,
                    minHeight: 22,
                  }}
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? 0)}
                  onSelect={(e) => {
                    const ta = e.target as HTMLTextAreaElement;
                    setSlashRange(extractSlashQuery(ta.value, ta.selectionStart ?? 0));
                  }}
                  onBlur={() => {
                    // Close on blur after the click handler has had a chance to fire
                    setTimeout(() => setSlashRange(null), 120);
                  }}
                  onPaste={(e) => {
                    const cd = e.clipboardData;
                    if (!cd) return;
                    const files = Array.from(cd.files || []);
                    if (files.length) {
                      e.preventDefault();
                      addFiles(files);
                      flashPasteHint(`Added ${files.length} file${files.length === 1 ? '' : 's'}`);
                      return;
                    }
                    const text = cd.getData('text/plain');
                    if (text && text.length >= SMART_PASTE_THRESHOLD) {
                      e.preventDefault();
                      const att = ingestPastedText(text);
                      setAttachments((cur) => [...cur, att]);
                      flashPasteHint(`Long paste (${text.length.toLocaleString()} chars) converted to attachment`);
                    }
                  }}
                  onKeyDown={(e) => {
                    // Slash menu navigation takes priority while open.
                    if (slashRange && slashCommands.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSlashIdx((i) => (i + 1) % slashCommands.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSlashIdx((i) => (i - 1 + slashCommands.length) % slashCommands.length);
                        return;
                      }
                      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        const cmd = slashCommands[slashIdx];
                        if (cmd) applySlashCommand(cmd);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setSlashRange(null);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  aria-label="Message composer"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add attachment"
                  title="Add files or images"
                  disabled={busy}
                  style={iconBtnStyle}
                >
                  <Paperclip size={13} />
                </button>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  profile · <span style={{ color: 'var(--accent)' }}>{profile}</span>
                </span>
                <Btn
                  variant="primary"
                  size="sm"
                  icon={<Send size={12} />}
                  onClick={() => send()}
                  disabled={busy || !input.trim()}
                >
                  Send
                </Btn>
              </div>
            </div>
            {pasteHint && (
              <div
                className="composer-hint"
                role="status"
                aria-live="polite"
                style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}
              >
                {pasteHint}
              </div>
            )}
          </div>
        </section>

        {/* Run timeline (desktop) */}
        <aside
          className="chat-panel right-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div
            className="panel-header"
            style={{
              padding: '14px 16px 12px',
              borderBottom: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <Kicker style={{ marginBottom: 4 }}>RUN TIMELINE</Kicker>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 620, color: 'var(--strong-text)', letterSpacing: '-.012em' }}>Live events</h2>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>Newest first · deltas merged</div>
            </div>
            {timeline.length > 0 && (
              <Btn size="sm" variant="ghost" onClick={clearTimeline} aria-label="Clear timeline">Clear</Btn>
            )}
          </div>
          <div className="panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14 }}>
            <TimelineView items={timeline} busy={busy} />
          </div>
        </aside>
      </div>
      </div>

      {/* Mobile: sessions sheet (opened via header button on mobile chat) */}
      <div
        className={`sheet-backdrop ${sessionsOpen ? 'open' : ''}`}
        onClick={() => setSessionsOpen(false)}
        aria-hidden
      />
      <div className={`sheet ${sessionsOpen ? 'open' : ''}`} role="dialog" aria-label="Sessions list">
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid var(--hairline)', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Kicker style={{ marginBottom: 4 }}>CONVERSATIONS</Kicker>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 620, color: 'var(--strong-text)' }}>Sessions</h2>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>profile · <Kbd>{profile}</Kbd></div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="primary" icon={<Plus size={11} />} onClick={newChat}>New</Btn>
            <button onClick={() => setSessionsOpen(false)} aria-label="Close" style={iconBtnStyle}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="sessions-toolbar mobile" style={{ padding: '10px 12px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select className="select" value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Select profile" style={selectStyle}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? ' · active' : ''}</option>)}
          </select>
          <div
            className="input-group sessions-search"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 30,
              padding: '0 10px',
              background: 'var(--bg-soft)',
              border: '1px solid var(--line)',
              borderRadius: 8,
            }}
          >
            <Search size={12} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
            <input
              placeholder={showArchived ? 'Search archived…' : 'Search sessions or #tags'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 12.5,
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>
          <div className="sessions-tabs" role="tablist" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <TabBtn active={!showArchived} onClick={() => setShowArchived(false)}>All</TabBtn>
            <TabBtn active={showArchived} onClick={() => setShowArchived(true)}>Archived</TabBtn>
            <button
              className="sessions-folder-add"
              onClick={() => setDialog({ kind: 'newFolder' })}
              aria-label="New folder"
              title="New folder"
              type="button"
              style={iconBtnStyle}
            >
              <FolderPlus size={12} />
            </button>
            <div className="sessions-source-wrap" style={{ position: 'relative', marginLeft: 'auto' }}>{renderSourceFilter()}</div>
          </div>
        </div>
        <div className="sheet-body">{SessionList}</div>
      </div>
      {dialogNode}
    </div>
  );
}

// ─── Inline shell helpers (chat page only) ───────────────────────────────

const selectStyle: React.CSSProperties = {
  height: 30,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--bg-soft)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12.5,
  cursor: 'pointer',
  outline: 'none',
  width: '100%',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'var(--panel-2)',
  border: '1px solid var(--line)',
  color: 'var(--muted)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
};

function TabBtn({
  active, onClick, icon, children,
}: {
  active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 26,
        padding: '0 10px',
        borderRadius: 999,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--muted)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
        fontFamily: 'var(--font-sans)',
        fontSize: 11.5,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function TimelineView({ items, busy }: { items: TimelineItem[]; busy: boolean }) {
  if (items.length === 0) {
    return (
      <div
        className="tl-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 8,
          padding: '36px 12px',
          color: 'var(--muted)',
        }}
      >
        <Radio size={20} style={{ color: 'var(--muted-2)' }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 220 }}>
          {busy ? 'Waiting for first Hermes event…' : 'Tool calls, status, and stream events will show up here'}
        </div>
      </div>
    );
  }
  return (
    <div className="tl-list" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', left: 7, top: 6, bottom: 6, width: 1, background: 'var(--hairline)' }} />
      {items.map((it) => {
        const tone =
          it.kind === 'tool' ? 'var(--accent)' :
          it.kind === 'error' ? 'var(--red)' :
          it.kind === 'done' ? 'var(--green)' :
          it.kind === 'message' ? 'var(--accent)' :
          'var(--muted-2)';
        const ringColor =
          it.kind === 'tool' ? 'rgba(56,189,248,.18)' :
          it.kind === 'error' ? 'rgba(239,68,68,.18)' :
          it.kind === 'done' ? 'rgba(34,197,94,.18)' :
          it.kind === 'message' ? 'rgba(56,189,248,.16)' :
          'rgba(150,150,160,.16)';
        const Icon =
          it.kind === 'tool' ? Wrench :
          it.kind === 'error' ? AlertCircle :
          it.kind === 'done' ? CheckCircle2 :
          it.kind === 'message' ? MessageSquare :
          Activity;
        return (
          <div key={it.id} className="tl-item" style={{ position: 'relative', paddingLeft: 24, paddingBottom: 14 }}>
            <span
              style={{
                position: 'absolute',
                left: 3,
                top: 4,
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: tone,
                boxShadow: `0 0 0 3px ${ringColor}`,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
              <Kicker>
                <Icon size={9} style={{ verticalAlign: -1, marginRight: 4 }} />
                {it.title}
                {!!it.count && it.count > 1 && (
                  <span style={{ marginLeft: 6, color: 'var(--muted-2)' }}>×{it.count}</span>
                )}
              </Kicker>
              <span style={{ fontSize: 10, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
                {new Date(it.ts).toLocaleTimeString()}
              </span>
            </div>
            {it.summary && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45, fontFamily: 'var(--font-mono)' }}>
                {it.summary}
              </div>
            )}
          </div>
        );
      })}
      {busy && (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          <span
            style={{
              position: 'absolute',
              left: 3,
              top: 4,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'transparent',
              border: '2px dashed var(--muted-2)',
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Streaming…</div>
        </div>
      )}
    </div>
  );
}

// ─── Tool / subagent message renderers ───────────────────────────────────
// Used in the chat thread when the user opts into tool-detail mode. Both
// renderers favor a compact summary line and let the user expand for the raw
// JSON if they're actually debugging.

function tryFormatJson(raw: string): { formatted: string; isJson: boolean } {
  if (!raw) return { formatted: '', isJson: false };
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return { formatted: raw, isJson: false };
  try {
    return { formatted: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
  } catch {
    return { formatted: raw, isJson: false };
  }
}

function ToolCallSummary({ calls }: { calls: Array<{ id?: string; name?: string; arguments?: string }> }) {
  const [open, setOpen] = useState(false);
  const subagent = calls.some((c) => isSubagentTool(c.name));
  const Icon = subagent ? Network : Wrench;
  const title = subagent ? 'Delegate to subagent' : 'Tool call';
  return (
    <div className={`tool-block${subagent ? ' subagent' : ''}`}>
      <div className="tool-block-head" onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>
        <Icon size={12} />
        <span className="tool-block-title">
          {title} {calls.length > 1 && <span className="muted">×{calls.length}</span>}
        </span>
        <span className="tool-block-names">
          {calls.map((c) => c.name).filter(Boolean).join(' · ') || 'tool'}
        </span>
        <ChevronDown size={12} className={`tool-block-chev ${open ? 'open' : ''}`} />
      </div>
      {open && (
        <div className="tool-block-body">
          {calls.map((c, i) => {
            const parsed = tryFormatJson(c.arguments || '');
            return (
              <div key={c.id || i} className="tool-call-entry">
                <div className="tool-call-name">
                  {isSubagentTool(c.name) && <Bot size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                  {c.name || 'tool'}
                </div>
                <pre className="tool-call-args">{parsed.formatted || '(no args)'}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Try to extract the most useful preview line for a delegate_task result.
// The shape is `{results:[{task_index, status, summary, ...}, ...]}` — the
// summary is the subagent's actual answer, much more useful than raw JSON keys.
function extractSubagentPreview(content: string): string | null {
  try {
    const obj = JSON.parse(content);
    const results = obj && typeof obj === 'object' ? (obj.results as unknown) : null;
    if (Array.isArray(results) && results.length) {
      const first = results[0] as Record<string, unknown>;
      const summary = typeof first?.summary === 'string' ? first.summary : '';
      const status = typeof first?.status === 'string' ? `[${first.status}] ` : '';
      const head = (status + summary).replace(/\s+/g, ' ').trim();
      if (head) return head.length > 160 ? head.slice(0, 160) + '…' : head;
    }
  } catch {}
  return null;
}

function ToolResultSummary({ toolName, content }: { toolName?: string; content: string }) {
  const [open, setOpen] = useState(false);
  const subagent = isSubagentTool(toolName);
  const parsed = tryFormatJson(content);
  // Subagent results carry a human-readable summary buried in JSON — surface
  // that instead of generic key:value preview.
  const preview = subagent
    ? (extractSubagentPreview(content) ?? '')
    : parsed.isJson
      ? (() => {
          try {
            const obj = JSON.parse(content);
            if (obj && typeof obj === 'object') {
              const entries = Object.entries(obj as Record<string, unknown>).slice(0, 2);
              return entries.map(([k, v]) => {
                const s = typeof v === 'string' ? v : JSON.stringify(v);
                return `${k}: ${s.length > 60 ? s.slice(0, 60) + '…' : s}`;
              }).join(' · ');
            }
          } catch {}
          return '';
        })()
      : (content.length > 140 ? content.slice(0, 140) + '…' : content);
  const Icon = subagent ? Bot : CheckCircle2;
  const title = subagent ? 'Subagent result' : 'Tool result';
  return (
    <div className={`tool-block result${subagent ? ' subagent' : ''}`}>
      <div className="tool-block-head" onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>
        <Icon size={12} />
        <span className="tool-block-title">{title}</span>
        {toolName && <span className="tool-block-names">{toolName}</span>}
        <ChevronDown size={12} className={`tool-block-chev ${open ? 'open' : ''}`} />
      </div>
      {!open && preview && <div className="tool-block-preview">{preview}</div>}
      {open && (
        <pre className="tool-call-args">{parsed.formatted || content}</pre>
      )}
    </div>
  );
}
