'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertTriangle, Ban, BookOpen, CheckCircle2, ChevronDown, Clock,
  Eye, EyeOff, FileText, Filter, KanbanSquare, Link2, Loader2, PanelLeftClose, PanelLeftOpen,
  Pencil, Pin, PinOff,
  Play, Plus, RotateCw, Save, Send, Terminal, Trash2, Unlink, User, X,
} from 'lucide-react';
import { deckApi, ApiError } from '@/lib/api';
import type { DeckNotificationPreferences, KanbanBoard, KanbanMarkdownEntry, KanbanTask, KanbanTaskDetail, KanbanDiagnostic, KanbanStats, KanbanAssignee } from '@/lib/types';
import { Page, Card, Btn, Tag, Kicker, type Tone } from '@/components/Brand';
import { MessageContent } from '@/components/MessageContent';
import { useActiveProfile } from '@/lib/profile-context';
import { useT } from '@/lib/i18n';
import { relTime } from '@/lib/format';
import { notificationAllowed, parseKanbanCompletionNotification, showPageNotification } from '@/lib/notification-events';
import {
  COLUMNS,
  DEFAULT_BOARD_LS_KEY,
  DETAIL_WIDTH_DEFAULT,
  DETAIL_WIDTH_LS_KEY,
  POLL_MS,
  SECONDARY_POLL_MS,
  SHOW_EMPTY_LS_KEY,
  SSE_DEBOUNCE_MS,
  clampDetailWidth,
  formatBytes,
  readDetailWidth,
  readLocalString,
  statusTone,
  writeLocalString,
  type ColumnKey,
} from './_lib/kanban-ui';

export default function KanbanPage() {
  const { profiles, activeProfile } = useActiveProfile();
  const t = useT({
    zh: {
      intro: 'Hermes Kanban —— 多 agent 共享一块持久看板，worker 自动认领、心跳、重试，挂掉会自动 reclaim。本页 1:1 读 ~/.hermes/kanban.db，操作走 hermes kanban CLI。',
      newTask: '新建任务',
      refresh: '刷新',
      board: '看板',
      triage: '待澄清',
      todo: '待就绪',
      ready: '待领',
      running: '运行中',
      blocked: '已阻塞',
      done: '已完成',
      archived: '已归档',
      empty: '该列暂无任务',
      tasksCount: (n: number) => `${n} 个任务`,
      total: '总计',
      assign: '指派',
      complete: '标完成',
      block: '阻塞',
      unblock: '解除阻塞',
      archive: '归档',
      reclaim: '回收',
      comment: '评论',
      addComment: '添加评论',
      noComments: '暂无评论',
      taskHistory: '事件流',
      runs: '运行历史',
      noEvents: '暂无事件',
      noRuns: '暂未运行过',
      taskTitle: '任务标题',
      taskBody: '任务描述（可选）',
      assignee: '负责人 (profile)',
      priority: '优先级',
      workspace: '工作目录',
      ws_scratch: 'scratch（临时）',
      ws_pinned: 'worktree（每任务一份 git worktree）',
      ws_session: 'dir:<path>（指定路径）',
      wsPath: '工作目录路径',
      submit: '创建',
      cancel: '取消',
      saving: '保存中',
      reasonOpt: '原因（可选）',
      summaryOpt: '总结（可选）',
      blockReason: '阻塞原因（可选）',
      assignProfile: '指派给 Agent',
      unassign: '清除指派',
      created: '创建时间',
      started: '开始时间',
      completed: '完成时间',
      retry: '失败次数',
      heartbeat: '心跳',
      worker: 'PID',
      loadFailed: '加载失败',
      retryLoad: '重试',
      actionFailed: '操作失败：',
      noTaskSelected: '点击任意任务查看详情',
      titleRequired: '标题不能为空',
      writeComment: '写一条评论…',
      pickProfile: '选择 Agent…',
      // batch 1-3 additions
      diagnostics: '告警',
      diagnosticsEmpty: '看板健康，没有告警',
      diagnosticsNone: '当前任务无告警',
      stats: '统计',
      oldestReady: '最久待领',
      live: '实时',
      polling: '轮询',
      assigneeFilter: '负责人',
      allAssignees: '全部',
      unassigned: '未指派',
      logTitle: '运行日志',
      logEmpty: '该任务还没有 worker 日志',
      logRefresh: '刷新',
      logTailLast: '最近 N KB',
      logFull: '加载全部',
      contextTitle: '上下文（worker 视角）',
      contextEmpty: '该任务暂无可见上下文',
      contextLoad: '查看 worker 上下文',
      logLoad: '查看 worker 日志',
      editTitle: '编辑已完成任务',
      editResult: '结果文本',
      editSummary: '摘要（可选，缺省回落到结果）',
      editMetadata: 'Metadata JSON（可选）',
      editSubmit: '保存',
      editOpen: '编辑结果',
      linkTitle: '依赖关系',
      linkAdd: '添加子任务',
      linkChildPlaceholder: '子任务 id（如 t_xxxxx）',
      linkRemove: '解除',
      linkSelf: '父子任务不能相同',
      linkInvalid: '任务 id 格式不对',
      sectionParents: '父任务',
      sectionChildren: '子任务',
      // feature additions
      pinDefault: '设为默认看板',
      unpinDefault: '取消默认',
      defaultPinned: '默认',
      hideEmpty: '隐藏空列',
      showEmpty: '显示空列',
      emptyHidden: (n: number) => `${n} 个空列已收起`,
      mdLoad: '查看 MD 文档',
      mdTitle: '工作区 Markdown',
      mdEmpty: '工作区里暂未发现 .md 文件',
      mdNoWorkspace: '该任务没有可用的工作目录路径',
      mdEdit: '编辑',
      mdPreview: '预览',
      mdSave: '保存',
      mdSaving: '保存中',
      mdSaved: '已保存',
      mdConflict: '保存冲突：该文件在磁盘上已被改动（worker 可能重写了它）。请先刷新再保存。',
      mdSize: (n: number) => `${formatBytes(n)}`,
      mdReload: '刷新',
      mdSelectHint: '从左侧选择文件',
      mdShowFiles: '文件列表',
      mdHideFiles: '隐藏列表',
      mdResultHeader: 'Result（Markdown 预览）',
      mdResultEmpty: '该任务还没有 result',
      detailResize: '拖动调整详情面板宽度（双击重置）',
    },
    en: {
      intro: 'Hermes Kanban — a durable, multi-agent shared board. Workers self-claim, heartbeat, retry; crashed workers are auto-reclaimed. This page reads ~/.hermes/kanban.db 1:1; mutations go through the hermes kanban CLI.',
      newTask: 'New task',
      refresh: 'Refresh',
      board: 'Board',
      triage: 'Triage',
      todo: 'Todo',
      ready: 'Ready',
      running: 'Running',
      blocked: 'Blocked',
      done: 'Done',
      archived: 'Archived',
      empty: 'No tasks in this column',
      tasksCount: (n: number) => `${n} task${n === 1 ? '' : 's'}`,
      total: 'Total',
      assign: 'Assign',
      complete: 'Complete',
      block: 'Block',
      unblock: 'Unblock',
      archive: 'Archive',
      reclaim: 'Reclaim',
      comment: 'Comment',
      addComment: 'Add comment',
      noComments: 'No comments yet',
      taskHistory: 'Event stream',
      runs: 'Runs',
      noEvents: 'No events yet',
      noRuns: 'No runs yet',
      taskTitle: 'Task title',
      taskBody: 'Body (optional)',
      assignee: 'Assignee (Agent)',
      priority: 'Priority',
      workspace: 'Workspace',
      ws_scratch: 'scratch (ephemeral)',
      ws_pinned: 'worktree (one git worktree per task)',
      ws_session: 'dir:<path> (specific path)',
      wsPath: 'Workspace path',
      submit: 'Create',
      cancel: 'Cancel',
      saving: 'Saving',
      reasonOpt: 'Reason (optional)',
      summaryOpt: 'Summary (optional)',
      blockReason: 'Block reason (optional)',
      assignProfile: 'Assign to profile',
      unassign: 'Unassign',
      created: 'Created',
      started: 'Started',
      completed: 'Completed',
      retry: 'Failures',
      heartbeat: 'Heartbeat',
      worker: 'PID',
      loadFailed: 'Load failed',
      retryLoad: 'Retry',
      actionFailed: 'Action failed: ',
      noTaskSelected: 'Pick a task to inspect',
      titleRequired: 'Title is required',
      writeComment: 'Write a comment…',
      pickProfile: 'Pick profile…',
      // batch 1-3 additions
      diagnostics: 'Diagnostics',
      diagnosticsEmpty: 'Board is healthy — no diagnostics',
      diagnosticsNone: 'No diagnostics on this task',
      stats: 'Stats',
      oldestReady: 'Oldest ready',
      live: 'Live',
      polling: 'Polling',
      assigneeFilter: 'Assignee',
      allAssignees: 'All',
      unassigned: 'Unassigned',
      logTitle: 'Worker log',
      logEmpty: 'No worker log yet for this task',
      logRefresh: 'Refresh',
      logTailLast: 'Last N KB',
      logFull: 'Load full',
      contextTitle: 'Worker context',
      contextEmpty: 'No context available for this task',
      contextLoad: 'Show worker context',
      logLoad: 'Show worker log',
      editTitle: 'Edit completed task',
      editResult: 'Result text',
      editSummary: 'Summary (optional, defaults to result)',
      editMetadata: 'Metadata JSON (optional)',
      editSubmit: 'Save',
      editOpen: 'Edit result',
      linkTitle: 'Dependencies',
      linkAdd: 'Add child task',
      linkChildPlaceholder: 'Child task id (e.g. t_xxxxx)',
      linkRemove: 'Unlink',
      linkSelf: 'Parent and child must differ',
      linkInvalid: 'Invalid task id',
      sectionParents: 'Parents',
      sectionChildren: 'Children',
      // feature additions
      pinDefault: 'Pin as default board',
      unpinDefault: 'Unpin default',
      defaultPinned: 'Default',
      hideEmpty: 'Hide empty',
      showEmpty: 'Show empty',
      emptyHidden: (n: number) => `${n} empty hidden`,
      mdLoad: 'Browse MD docs',
      mdTitle: 'Workspace markdown',
      mdEmpty: 'No .md files in workspace',
      mdNoWorkspace: 'Task has no workspace path',
      mdEdit: 'Edit',
      mdPreview: 'Preview',
      mdSave: 'Save',
      mdSaving: 'Saving',
      mdSaved: 'Saved',
      mdConflict: 'Save conflict: this file changed on disk since you opened it (a worker may have rewritten it). Reload before saving.',
      mdSize: (n: number) => `${formatBytes(n)}`,
      mdReload: 'Reload',
      mdSelectHint: 'Select a file on the left',
      mdShowFiles: 'Files',
      mdHideFiles: 'Hide files',
      mdResultHeader: 'Result (Markdown preview)',
      mdResultEmpty: 'No result yet on this task',
      detailResize: 'Drag to resize detail panel (double-click to reset)',
    },
  });

  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  // Default board picked once on mount, before the network round-trip lands.
  // Reading localStorage in useState's initializer keeps us SSR-safe (the
  // helper guards against window === undefined) and avoids a one-frame flicker
  // where the page mounts on 'default' and then hops to the pinned slug.
  const [activeBoard, setActiveBoard] = useState<string>(() => readLocalString(DEFAULT_BOARD_LS_KEY) || 'default');
  const [defaultBoard, setDefaultBoard] = useState<string>(() => readLocalString(DEFAULT_BOARD_LS_KEY));
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [boardCounts, setBoardCounts] = useState<KanbanBoard['counts'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [busy, setBusy] = useState<string>(''); // task id currently being mutated
  const [actionErr, setActionErr] = useState<string>('');

  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Batch 2/3 secondary state — diagnostics + stats + assignees, refreshed
  // less aggressively than the snapshot.
  const [diagnostics, setDiagnostics] = useState<KanbanDiagnostic[]>([]);
  const [stats, setStats] = useState<KanbanStats | null>(null);
  const [assignees, setAssignees] = useState<KanbanAssignee[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all'); // 'all' | 'unassigned' | <profile>

  // Modal state for the per-task tools.
  const [logFor, setLogFor] = useState<string>('');
  const [contextFor, setContextFor] = useState<string>('');
  const [editFor, setEditFor] = useState<string>('');
  const [mdFor, setMdFor] = useState<string>('');
  // When the user clicks an inline MD path, pre-load that file in the modal
  // instead of letting MarkdownModal auto-pick the most-recently-modified one.
  const [mdInitialFile, setMdInitialFile] = useState<string>('');

  // Show/hide empty status columns. Default off — we usually want to save the
  // horizontal space when entire columns are empty.
  const [showEmpty, setShowEmpty] = useState<boolean>(() => readLocalString(SHOW_EMPTY_LS_KEY) === '1');

  // Detail-panel width — drag handle on the panel's left edge mutates this.
  // Read once from localStorage on mount; writes are debounced 200ms so a
  // mid-drag stream of updates collapses to a single storage hit.
  const [detailWidth, setDetailWidth] = useState<number>(() => readDetailWidth());
  useEffect(() => {
    const timer = setTimeout(() => writeLocalString(DETAIL_WIDTH_LS_KEY, String(detailWidth)), 200);
    return () => clearTimeout(timer);
  }, [detailWidth]);

  // SSE status — falls back to polling if EventSource fails.
  const [liveMode, setLiveMode] = useState<'live' | 'polling'>('polling');

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<number>(0);
  const lastEventBoardRef = useRef<string>('');
  const selectedIdRef = useRef<string>('');
  const notificationPreferencesRef = useRef<DeckNotificationPreferences | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    deckApi.notificationConfig()
      .then((state) => { if (!cancelled) notificationPreferencesRef.current = state.preferences; })
      .catch(() => { if (!cancelled) notificationPreferencesRef.current = null; });
    return () => { cancelled = true; };
  }, []);

  const loadBoards = useCallback(async () => {
    try {
      const r = await deckApi.kanbanBoards();
      const list = r.boards || [];
      setBoards(list);
      // Pinned default wins; only fall back to Hermes' active flag when no pin.
      if (!activeBoard || activeBoard === 'default') {
        const pinned = readLocalString(DEFAULT_BOARD_LS_KEY);
        if (pinned && list.some((b) => b.slug === pinned)) {
          setActiveBoard(pinned);
        } else {
          const cur = list.find((b) => b.active)?.slug;
          if (cur && !activeBoard) setActiveBoard(cur);
        }
      }
    } catch {
      // Non-fatal: keep tasks fetch independent.
    }
  }, [activeBoard]);

  const loadSnapshot = useCallback(async (board: string) => {
    try {
      const r = await deckApi.kanbanSnapshot(board);
      setTasks(r.tasks || []);
      setBoardCounts(r.board?.counts || null);
      setErr('');
    } catch (e) {
      const detail = e instanceof ApiError ? `${e.status} ${e.message}` : (e instanceof Error ? e.message : String(e));
      setErr(detail);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSecondary = useCallback(async (board: string) => {
    // Run in parallel; errors are tolerated (the section just shows empty).
    const [d, s, a] = await Promise.allSettled([
      deckApi.kanbanDiagnostics(board),
      deckApi.kanbanStats(board),
      deckApi.kanbanAssignees(board),
    ]);
    if (d.status === 'fulfilled') setDiagnostics(d.value.diagnostics || []);
    if (s.status === 'fulfilled') setStats(s.value);
    if (a.status === 'fulfilled') setAssignees(a.value.assignees || []);
  }, []);

  // Initial load + board switch refetch.
  useEffect(() => { void loadBoards(); }, [loadBoards]);
  useEffect(() => {
    setLoading(true);
    void loadSnapshot(activeBoard);
    void loadSecondary(activeBoard);
  }, [activeBoard, loadSnapshot, loadSecondary]);

  // SSE subscription — debounced snapshot refresh on each event tick. Falls
  // back to plain polling if EventSource isn't available or the connection
  // errors out repeatedly.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setLiveMode('polling');
      return;
    }
    // Tear down any prior connection before opening a new one.
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    let cancelled = false;
    let errors = 0;

    const triggerRefresh = () => {
      if (sseDebounceRef.current) clearTimeout(sseDebounceRef.current);
      sseDebounceRef.current = setTimeout(() => {
        if (cancelled) return;
        void loadSnapshot(activeBoard);
        void loadBoards();
        const currentSelectedId = selectedIdRef.current;
        if (currentSelectedId) {
          deckApi.kanbanTaskDetail(activeBoard, currentSelectedId).then(setDetail).catch(() => {});
        }
      }, SSE_DEBOUNCE_MS);
    };

    // Event ids are scoped to the active board API query. Do not carry a cursor
    // from a previously viewed board, otherwise the first subscription for the
    // new board can skip events whose ids are lower than the old board cursor.
    if (lastEventBoardRef.current !== activeBoard) {
      lastEventBoardRef.current = activeBoard;
      lastEventIdRef.current = 0;
    }

    const url = deckApi.kanbanEventsUrl(activeBoard, lastEventIdRef.current, 1);
    const es = new EventSource(url);
    sseRef.current = es;
    es.onopen = () => { if (!cancelled) setLiveMode('live'); errors = 0; };
    es.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(ev.data);
        if (payload?.type === 'sync') {
          lastEventIdRef.current = Number(payload.lastId) || 0;
          return;
        }
        if (payload?.type === 'event') {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, Number(payload.id) || 0);
          const completion = parseKanbanCompletionNotification(payload, activeBoard);
          if (completion && notificationAllowed(notificationPreferencesRef.current, 'kanbanTaskCompleted')) {
            showPageNotification(completion);
          }
          triggerRefresh();
        }
      } catch {/* ignore malformed lines */}
    };
    es.onerror = () => {
      errors += 1;
      if (errors >= 3) {
        // Give up on SSE; the polling effect below carries the load.
        if (!cancelled) setLiveMode('polling');
        es.close();
      }
    };
    return () => {
      cancelled = true;
      es.close();
      if (sseRef.current === es) sseRef.current = null;
      if (sseDebounceRef.current) clearTimeout(sseDebounceRef.current);
    };
  }, [activeBoard, loadSnapshot, loadBoards]);

  // Background poll — same cadence as the runs page. When SSE is live we still
  // poll, but at half the rate, as a safety net if the stream silently stalls.
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    const ms = liveMode === 'live' ? POLL_MS * 3 : POLL_MS;
    refreshTimerRef.current = setInterval(() => {
      void loadSnapshot(activeBoard);
      void loadBoards();
    }, ms);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [activeBoard, loadSnapshot, loadBoards, liveMode]);

  // Secondary loop — diagnostics / stats / assignees on a slower cadence.
  useEffect(() => {
    if (secondaryTimerRef.current) clearInterval(secondaryTimerRef.current);
    secondaryTimerRef.current = setInterval(() => { void loadSecondary(activeBoard); }, SECONDARY_POLL_MS);
    return () => {
      if (secondaryTimerRef.current) clearInterval(secondaryTimerRef.current);
    };
  }, [activeBoard, loadSecondary]);

  // Detail loading.
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    deckApi.kanbanTaskDetail(activeBoard, selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setActionErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, activeBoard]);

  const grouped = useMemo(() => {
    const cols: Record<ColumnKey, KanbanTask[]> = { triage: [], todo: [], ready: [], running: [], blocked: [], done: [] };
    const matchAssignee = (task: KanbanTask) => {
      if (assigneeFilter === 'all') return true;
      if (assigneeFilter === 'unassigned') return !task.assignee;
      return task.assignee === assigneeFilter;
    };
    for (const task of tasks) {
      if (!matchAssignee(task)) continue;
      const key = (task.status as ColumnKey);
      if (cols[key]) cols[key].push(task);
    }
    return cols;
  }, [tasks, assigneeFilter]);

  const fmtCount = (n: number) => new Intl.NumberFormat().format(n);

  async function refresh() {
    setLoading(true);
    await Promise.all([loadSnapshot(activeBoard), loadBoards(), loadSecondary(activeBoard)]);
    if (selectedId) {
      try {
        const d = await deckApi.kanbanTaskDetail(activeBoard, selectedId);
        setDetail(d);
      } catch {}
    }
  }

  async function withBusy<T>(taskId: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(taskId);
    setActionErr('');
    try {
      const result = await fn();
      // After mutation: refresh snapshot + detail.
      await loadSnapshot(activeBoard);
      if (selectedId === taskId) {
        try { setDetail(await deckApi.kanbanTaskDetail(activeBoard, taskId)); } catch {}
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionErr(msg);
      return null;
    } finally {
      setBusy('');
    }
  }

  const onAction = async (taskId: string, op: 'block' | 'unblock' | 'complete' | 'archive' | 'reclaim') => {
    await withBusy(taskId, () => deckApi.kanbanTaskAction(activeBoard, taskId, op));
  };

  const onAssign = async (taskId: string, profileId: string | null) => {
    await withBusy(taskId, () => deckApi.kanbanTaskAssign(activeBoard, taskId, profileId));
  };

  const onComment = async (taskId: string, body: string) => {
    if (!body.trim()) return;
    await withBusy(taskId, () => deckApi.kanbanTaskComment(activeBoard, taskId, body));
  };

  const onCreate = async (input: Parameters<typeof deckApi.kanbanTaskCreate>[1]) => {
    setActionErr('');
    try {
      await deckApi.kanbanTaskCreate(activeBoard, input);
      setCreateOpen(false);
      await loadSnapshot(activeBoard);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const onLink = async (parentId: string, childId: string) => {
    await withBusy(parentId, () => deckApi.kanbanTaskLink(activeBoard, parentId, childId));
  };
  const onUnlink = async (parentId: string, childId: string) => {
    await withBusy(parentId, () => deckApi.kanbanTaskUnlink(activeBoard, parentId, childId));
  };
  const togglePinDefault = useCallback(() => {
    setDefaultBoard((cur) => {
      const next = cur === activeBoard ? '' : activeBoard;
      writeLocalString(DEFAULT_BOARD_LS_KEY, next);
      return next;
    });
  }, [activeBoard]);

  const toggleShowEmpty = useCallback(() => {
    setShowEmpty((v) => {
      const next = !v;
      writeLocalString(SHOW_EMPTY_LS_KEY, next ? '1' : '');
      return next;
    });
  }, []);

  const onEditTask = async (taskId: string, body: { result: string; summary?: string; metadata?: unknown }) => {
    setActionErr('');
    try {
      await deckApi.kanbanTaskEdit(activeBoard, taskId, body);
      setEditFor('');
      await loadSnapshot(activeBoard);
      if (selectedId === taskId) {
        try { setDetail(await deckApi.kanbanTaskDetail(activeBoard, taskId)); } catch {}
      }
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  // Empty-column accounting — used for both the BoardBar hint chip and the
  // grid that decides which columns to render.
  const visibleColumns = useMemo(() => {
    if (showEmpty) return COLUMNS;
    return COLUMNS.filter((col) => grouped[col].length > 0);
  }, [grouped, showEmpty]);
  const emptyColumnCount = COLUMNS.length - visibleColumns.length;

  return (
    <Page intro={t.intro} style={{ maxWidth: 'none' }}>
      <BoardBar
        boards={boards}
        active={activeBoard}
        defaultBoard={defaultBoard}
        onSwitch={setActiveBoard}
        onTogglePin={togglePinDefault}
        showEmpty={showEmpty}
        emptyColumnCount={emptyColumnCount}
        onToggleEmpty={toggleShowEmpty}
        onCreate={() => setCreateOpen(true)}
        onRefresh={refresh}
        counts={boardCounts}
        diagnostics={diagnostics}
        stats={stats}
        assignees={assignees}
        assigneeFilter={assigneeFilter}
        onAssigneeFilter={setAssigneeFilter}
        liveMode={liveMode}
        labels={{
          board: t.board,
          newTask: t.newTask,
          refresh: t.refresh,
          triage: t.triage,
          todo: t.todo,
          ready: t.ready,
          running: t.running,
          blocked: t.blocked,
          done: t.done,
          total: t.total,
          diagnostics: t.diagnostics,
          stats: t.stats,
          oldestReady: t.oldestReady,
          live: t.live,
          polling: t.polling,
          assigneeFilter: t.assigneeFilter,
          allAssignees: t.allAssignees,
          unassigned: t.unassigned,
          pinDefault: t.pinDefault,
          unpinDefault: t.unpinDefault,
          defaultPinned: t.defaultPinned,
          hideEmpty: t.hideEmpty,
          showEmpty: t.showEmpty,
          emptyHidden: t.emptyHidden,
        }}
      />

      {actionErr && (
        <Card style={{ borderColor: 'var(--status-red-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={13} />
            <span>{t.actionFailed}{actionErr}</span>
            <button
              onClick={() => setActionErr('')}
              aria-label="dismiss"
              style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer' }}
            ><X size={13} /></button>
          </div>
        </Card>
      )}

      {err && !loading && (
        <Card>
          <div style={{ fontSize: 12, color: 'var(--red)' }}>
            {t.loadFailed}: {err}
            <Btn size="sm" variant="ghost" onClick={refresh} style={{ marginLeft: 12 }}>{t.retryLoad}</Btn>
          </div>
        </Card>
      )}

      <div className="kanban-layout" style={{
        display: 'grid',
        gridTemplateColumns: selectedId ? `minmax(0, 1fr) ${detailWidth}px` : '1fr',
        gap: 14,
        alignItems: 'flex-start',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, visibleColumns.length)}, minmax(220px, 1fr))`,
          gap: 10,
        }}>
          {visibleColumns.map((col) => (
            <Column
              key={col}
              label={t[col]}
              tasks={grouped[col]}
              onPick={setSelectedId}
              selectedId={selectedId}
              busy={busy}
              loading={loading}
              empty={t.empty}
              count={t.tasksCount(grouped[col].length)}
            />
          ))}
        </div>

        {selectedId && (
          <div style={{ position: 'relative' }}>
            <DetailResizeHandle
              currentWidth={detailWidth}
              onResize={(n) => setDetailWidth(clampDetailWidth(n))}
              onReset={() => setDetailWidth(DETAIL_WIDTH_DEFAULT)}
              ariaLabel={t.detailResize}
            />
            <DetailPanel
              t={t}
              board={activeBoard}
              detail={detail}
              loading={detailLoading}
              busy={busy}
              profiles={profiles.map((p) => p.id)}
              activeProfile={activeProfile}
              allTaskIds={tasks.map((task) => task.id)}
              onClose={() => setSelectedId('')}
              onAction={onAction}
              onAssign={onAssign}
              onComment={onComment}
              onLink={onLink}
              onUnlink={onUnlink}
              onShowLog={() => setLogFor(detail?.id || '')}
              onShowContext={() => setContextFor(detail?.id || '')}
              onShowEdit={() => setEditFor(detail?.id || '')}
              onShowMarkdown={(rel) => {
                setMdFor(detail?.id || '');
                setMdInitialFile(rel || '');
              }}
              onJump={setSelectedId}
            />
          </div>
        )}
      </div>

      {createOpen && (
        <CreateDialog
          t={t}
          profiles={profiles.map((p) => p.id)}
          activeProfile={activeProfile}
          onCancel={() => setCreateOpen(false)}
          onSubmit={onCreate}
        />
      )}

      {logFor && (
        <LogModal board={activeBoard} taskId={logFor} t={t} onClose={() => setLogFor('')} />
      )}
      {contextFor && (
        <ContextModal board={activeBoard} taskId={contextFor} t={t} onClose={() => setContextFor('')} />
      )}
      {editFor && (
        <EditDialog
          t={t}
          taskId={editFor}
          initial={detail && detail.id === editFor ? { result: detail.result || '', summary: '' } : { result: '', summary: '' }}
          onCancel={() => setEditFor('')}
          onSubmit={(b) => onEditTask(editFor, b)}
        />
      )}
      {mdFor && (
        <MarkdownModal
          board={activeBoard}
          taskId={mdFor}
          t={t}
          initialFile={mdInitialFile}
          onClose={() => { setMdFor(''); setMdInitialFile(''); }}
        />
      )}
    </Page>
  );
}

// ─── BoardBar ───────────────────────────────────────────────────────────

interface BoardBarLabels {
  board: string; newTask: string; refresh: string;
  triage: string; todo: string; ready: string; running: string; blocked: string; done: string; total: string;
  diagnostics: string; stats: string; oldestReady: string;
  live: string; polling: string;
  assigneeFilter: string; allAssignees: string; unassigned: string;
  pinDefault: string; unpinDefault: string; defaultPinned: string;
  hideEmpty: string; showEmpty: string; emptyHidden: (n: number) => string;
}

function BoardBar({
  boards, active, defaultBoard, onSwitch, onTogglePin,
  showEmpty, emptyColumnCount, onToggleEmpty,
  onCreate, onRefresh, counts,
  diagnostics, stats, assignees, assigneeFilter, onAssigneeFilter, liveMode, labels,
}: {
  boards: KanbanBoard[];
  active: string;
  defaultBoard: string;
  onSwitch: (slug: string) => void;
  onTogglePin: () => void;
  showEmpty: boolean;
  emptyColumnCount: number;
  onToggleEmpty: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  counts: KanbanBoard['counts'] | null | undefined;
  diagnostics: KanbanDiagnostic[];
  stats: KanbanStats | null;
  assignees: KanbanAssignee[];
  assigneeFilter: string;
  onAssigneeFilter: (v: string) => void;
  liveMode: 'live' | 'polling';
  labels: BoardBarLabels;
}) {
  const isPinned = defaultBoard === active && !!active;
  const total = counts?.total ?? 0;
  const sevCounts = useMemo(() => {
    const c = { warning: 0, error: 0, critical: 0 };
    for (const d of diagnostics) {
      if (d.severity === 'warning') c.warning += 1;
      else if (d.severity === 'error') c.error += 1;
      else if (d.severity === 'critical') c.critical += 1;
    }
    return c;
  }, [diagnostics]);
  const diagTotal = sevCounts.warning + sevCounts.error + sevCounts.critical;
  const diagTone: Tone = sevCounts.critical || sevCounts.error ? 'red' : sevCounts.warning ? 'yellow' : 'green';
  const [diagOpen, setDiagOpen] = useState(false);

  const oldestReadyText = useMemo(() => {
    const sec = stats?.oldestReadyAgeSec;
    if (!sec || sec <= 0) return null;
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h`;
    return `${Math.round(sec / 86400)}d`;
  }, [stats]);

  return (
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KanbanSquare size={16} style={{ color: 'var(--accent)' }} />
          <Kicker style={{ marginRight: 4 }}>{labels.board}</Kicker>
          <select
            value={active}
            onChange={(e) => onSwitch(e.target.value)}
            style={{
              height: 30,
              padding: '0 24px 0 10px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--bg-soft)',
              color: 'var(--strong-text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              minWidth: 180,
              appearance: 'none',
              backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%)',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'calc(100% - 13px) 50%, calc(100% - 8px) 50%',
              backgroundSize: '5px 5px, 5px 5px',
            }}
          >
            {boards.length === 0 && <option value="default">default</option>}
            {boards.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}{b.slug !== b.name ? ` (${b.slug})` : ''}{defaultBoard === b.slug ? ' ★' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onTogglePin}
            title={isPinned ? labels.unpinDefault : labels.pinDefault}
            aria-pressed={isPinned}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              borderRadius: 8,
              border: `1px solid ${isPinned ? 'var(--accent-border)' : 'var(--line)'}`,
              background: isPinned ? 'var(--accent-soft)' : 'var(--bg-soft)',
              color: isPinned ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
          {isPinned && <Tag variant="accent">{labels.defaultPinned}</Tag>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tag variant="yellow">{labels.triage} {counts?.triage ?? 0}</Tag>
          <Tag>{labels.todo} {counts?.todo ?? 0}</Tag>
          <Tag variant="cyan">{labels.ready} {counts?.ready ?? 0}</Tag>
          <Tag variant="accent">{labels.running} {counts?.running ?? 0}</Tag>
          <Tag variant="red">{labels.blocked} {counts?.blocked ?? 0}</Tag>
          <Tag variant="green">{labels.done} {counts?.done ?? 0}</Tag>
          <Tag>{labels.total} {total}</Tag>
          {oldestReadyText && (
            <Tag variant="yellow" icon={<Clock size={10} />}>{labels.oldestReady} {oldestReadyText}</Tag>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Assignee filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Filter size={11} style={{ color: 'var(--muted-2)' }} />
            <select
              value={assigneeFilter}
              onChange={(e) => onAssigneeFilter(e.target.value)}
              title={labels.assigneeFilter}
              style={{
                height: 26, padding: '0 22px 0 8px',
                borderRadius: 6, border: '1px solid var(--line)',
                background: 'var(--bg-soft)', color: 'var(--strong-text)',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                appearance: 'none',
                backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%)',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'calc(100% - 12px) 50%, calc(100% - 7px) 50%',
                backgroundSize: '5px 5px, 5px 5px',
              }}
            >
              <option value="all">{labels.assigneeFilter}: {labels.allAssignees}</option>
              <option value="unassigned">{labels.unassigned}</option>
              {assignees.map((a) => (
                <option key={a.profile} value={a.profile}>
                  {a.profile} ({a.counts.total})
                </option>
              ))}
            </select>
          </div>

          {/* Diagnostics chip — clickable when there are any */}
          <button
            type="button"
            onClick={() => diagTotal > 0 && setDiagOpen((v) => !v)}
            disabled={diagTotal === 0}
            title={diagTotal === 0 ? labels.diagnostics : `${labels.diagnostics}: ${diagTotal}`}
            style={{
              background: 'transparent', border: 0, padding: 0,
              cursor: diagTotal > 0 ? 'pointer' : 'default',
            }}
          >
            <Tag variant={diagTotal === 0 ? 'green' : diagTone} icon={<AlertTriangle size={10} />}>
              {labels.diagnostics} {diagTotal}
            </Tag>
          </button>

          {/* Live indicator */}
          <Tag variant={liveMode === 'live' ? 'green' : 'default'} icon={liveMode === 'live'
            ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', boxShadow: '0 0 0 3px var(--status-green-bg)' }} />
            : <Clock size={9} />
          }>
            {liveMode === 'live' ? labels.live : labels.polling}
          </Tag>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', minWidth: 0 }}>
          {(emptyColumnCount > 0 || showEmpty) && (
            <Btn
              variant="ghost"
              size="sm"
              icon={showEmpty ? <EyeOff size={12} /> : <Eye size={12} />}
              onClick={onToggleEmpty}
            >
              {showEmpty
                ? labels.hideEmpty
                : (emptyColumnCount > 0 ? labels.emptyHidden(emptyColumnCount) : labels.showEmpty)}
            </Btn>
          )}
          <Btn variant="ghost" size="sm" icon={<RotateCw size={12} />} onClick={onRefresh}>
            {labels.refresh}
          </Btn>
          <Btn variant="primary" size="sm" icon={<Plus size={13} />} onClick={onCreate}>
            {labels.newTask}
          </Btn>
        </div>
      </div>

      {diagOpen && diagTotal > 0 && (
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 8,
          border: '1px solid var(--hairline)', background: 'var(--bg-soft)',
          display: 'flex', flexDirection: 'column', gap: 6,
          maxHeight: 200, overflowY: 'auto',
        }}>
          {diagnostics.map((d, idx) => (
            <div key={`${d.taskId || ''}-${idx}`} style={{
              display: 'flex', gap: 6, alignItems: 'flex-start',
              fontSize: 11.5, color: 'var(--text)',
            }}>
              <Tag variant={d.severity === 'critical' || d.severity === 'error' ? 'red' : 'yellow'}>
                {d.severity}
              </Tag>
              {d.taskId && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted-2)' }}>
                  {d.taskId.slice(0, 12)}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--accent)', marginRight: 6 }}>{d.kind}</span>
                {d.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Column ─────────────────────────────────────────────────────────────

function Column({
  label, tasks, onPick, selectedId, busy, loading, empty, count,
}: {
  label: string;
  tasks: KanbanTask[];
  onPick: (id: string) => void;
  selectedId: string;
  busy: string;
  loading: boolean;
  empty: string;
  count: string;
}) {
  return (
    <div style={{
      background: 'var(--surface-bg)',
      border: '1px solid var(--hairline)',
      borderRadius: 12,
      padding: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minHeight: 160,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 6px' }}>
        <Kicker>{label}</Kicker>
        <span style={{ fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{count}</span>
      </div>
      {tasks.length === 0 && !loading && (
        <div style={{ padding: '14px 8px', textAlign: 'center', fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
          {empty}
        </div>
      )}
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} active={task.id === selectedId} busy={busy === task.id} onPick={onPick} />
      ))}
    </div>
  );
}

function TaskCard({ task, active, busy, onPick }: { task: KanbanTask; active: boolean; busy: boolean; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(task.id)}
      style={{
        textAlign: 'left',
        padding: 10,
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
        background: active ? 'var(--accent-soft)' : 'var(--panel)',
        borderRadius: 8,
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: busy ? 0.65 : 1,
        transition: 'background 200ms cubic-bezier(.2,.7,.2,1), border-color 200ms cubic-bezier(.2,.7,.2,1), color 200ms cubic-bezier(.2,.7,.2,1), opacity 200ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      <div style={{
        fontSize: 12.5,
        fontWeight: 550,
        color: 'var(--strong-text)',
        lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{task.title || task.id}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted-2)' }}>{task.id.slice(0, 12)}</span>
        {task.assignee && <Tag variant="default" icon={<User size={9} />}>{task.assignee}</Tag>}
        {task.priority > 0 && <Tag variant="yellow">P{task.priority}</Tag>}
        {(task.consecutiveFailures || 0) > 0 && <Tag variant="red">×{task.consecutiveFailures}</Tag>}
      </div>
      {task.startedAt && task.status === 'running' && (
        <div style={{ fontSize: 10, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={9} /> {relTime(task.startedAt)}
        </div>
      )}
    </button>
  );
}

// ─── DetailResizeHandle ─────────────────────────────────────────────────
// Thin vertical drag bar overlaid on the gap between the kanban columns and
// the detail panel. Sits inside a `position: relative` wrapper around
// DetailPanel; the handle absolutely positions itself to straddle the gap so
// the hit area covers the whole strip the user sees as "between the cards."
//
// Drag = adjust width (clamped); double-click = reset to default. Width
// state lives on the page so we can persist it; this component only owns
// transient drag state (active / hover) used for the visual treatment.
function DetailResizeHandle({
  currentWidth,
  onResize,
  onReset,
  ariaLabel,
}: {
  currentWidth: number;
  onResize: (next: number) => void;
  onReset: () => void;
  ariaLabel: string;
}) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);

  const onMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // Only respond to primary button.
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = currentWidth;
    setActive(true);
    // Suppress text selection / cursor flicker over the rest of the page.
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    // Handle is on the LEFT edge of the panel — dragging left widens it.
    const onMove = (ev: MouseEvent) => {
      onResize(startW - (ev.clientX - startX));
    };
    const onUp = () => {
      setActive(false);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [currentWidth, onResize]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title={ariaLabel}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Sit centered on the boundary between the gap and the card. The
        // wrapper's left:0 is the card's left edge; left:-7 + width:14 puts
        // the hit area straddling that edge so a drag near either side works.
        position: 'absolute',
        left: -7,
        top: 0,
        bottom: 0,
        width: 14,
        cursor: 'ew-resize',
        zIndex: 5,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          width: active ? 3 : (hovered ? 2 : 1),
          background: active
            ? 'var(--accent)'
            : (hovered ? 'var(--accent-border)' : 'var(--hairline)'),
          transition: 'background 120ms, opacity 120ms',
          borderRadius: 2,
          opacity: active ? 1 : (hovered ? 0.9 : 0.4),
        }}
      />
    </div>
  );
}

// ─── DetailPanel ────────────────────────────────────────────────────────

interface DetailLabels {
  comment: string;
  addComment: string;
  noComments: string;
  taskHistory: string;
  runs: string;
  noEvents: string;
  noRuns: string;
  assign: string;
  complete: string;
  block: string;
  unblock: string;
  archive: string;
  reclaim: string;
  pickProfile: string;
  unassign: string;
  created: string;
  started: string;
  completed: string;
  retry: string;
  heartbeat: string;
  worker: string;
  noTaskSelected: string;
  writeComment: string;
  // batch 1-3
  logLoad: string;
  contextLoad: string;
  editOpen: string;
  linkTitle: string;
  linkAdd: string;
  linkChildPlaceholder: string;
  linkRemove: string;
  linkSelf: string;
  linkInvalid: string;
  sectionParents: string;
  sectionChildren: string;
  // markdown viewer + result preview
  mdLoad: string;
  mdResultHeader: string;
  mdResultEmpty: string;
}

function DetailPanel({
  t, board, detail, loading, busy, profiles, activeProfile, allTaskIds,
  onClose, onAction, onAssign, onComment, onLink, onUnlink,
  onShowLog, onShowContext, onShowEdit, onShowMarkdown, onJump,
}: {
  t: DetailLabels;
  board: string;
  detail: KanbanTaskDetail | null;
  loading: boolean;
  busy: string;
  profiles: string[];
  activeProfile: string;
  allTaskIds: string[];
  onClose: () => void;
  onAction: (id: string, op: 'block' | 'unblock' | 'complete' | 'archive' | 'reclaim') => Promise<void>;
  onAssign: (id: string, profile: string | null) => Promise<void>;
  onComment: (id: string, body: string) => Promise<void>;
  onLink: (parentId: string, childId: string) => Promise<void>;
  onUnlink: (parentId: string, childId: string) => Promise<void>;
  onShowLog: () => void;
  onShowContext: () => void;
  onShowEdit: () => void;
  // Accepts an optional workspace-relative path to pre-load in the modal —
  // populated when the user clicks an inline MD path in the body / result.
  onShowMarkdown: (initialFile?: string) => void;
  onJump: (id: string) => void;
}) {
  const [commentDraft, setCommentDraft] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => { setCommentDraft(''); setAssignOpen(false); }, [detail?.id]);

  if (loading && !detail) {
    return (
      <Card style={{ minHeight: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160, color: 'var(--muted-2)', gap: 6 }}>
          <Loader2 size={14} className="spin" /> Loading…
        </div>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center', padding: '24px 8px' }}>
          {t.noTaskSelected}
        </div>
      </Card>
    );
  }

  const isBusy = busy === detail.id;
  const status = detail.status;
  const isRunning = status === 'running';
  const isBlocked = status === 'blocked';
  const isDone = status === 'done';
  const isArchived = status === 'archived';

  return (
    <Card padding={14} style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Tag variant={statusTone(status)}>{status}</Tag>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--strong-text)', lineHeight: 1.4 }}>
            {detail.title || detail.id}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>
            {detail.id} · {board}
          </div>
        </div>
        <button onClick={onClose} aria-label="close" style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      {detail.body && (
        <div style={{
          fontSize: 12,
          color: 'var(--text)',
          background: 'var(--bg-soft)',
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--hairline)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <BodyWithMdLinks
            text={detail.body}
            workspacePath={detail.workspacePath}
            onOpenMd={onShowMarkdown}
          />
        </div>
      )}

      <MetaGrid t={t} task={detail} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {!isDone && !isArchived && (
          <Btn size="sm" variant="ghost" icon={<User size={11} />} disabled={isBusy} onClick={() => setAssignOpen((v) => !v)}>
            {detail.assignee || t.assign}
          </Btn>
        )}
        {!isDone && !isArchived && !isBlocked && (
          <Btn size="sm" variant="ghost" icon={<Ban size={11} />} disabled={isBusy} onClick={() => onAction(detail.id, 'block')}>
            {t.block}
          </Btn>
        )}
        {isBlocked && (
          <Btn size="sm" variant="ghost" icon={<Play size={11} />} disabled={isBusy} onClick={() => onAction(detail.id, 'unblock')}>
            {t.unblock}
          </Btn>
        )}
        {isRunning && (
          <Btn size="sm" variant="ghost" icon={<RotateCw size={11} />} disabled={isBusy} onClick={() => onAction(detail.id, 'reclaim')}>
            {t.reclaim}
          </Btn>
        )}
        {!isDone && !isArchived && (
          <Btn size="sm" variant="ghost" icon={<CheckCircle2 size={11} />} disabled={isBusy} onClick={() => onAction(detail.id, 'complete')}>
            {t.complete}
          </Btn>
        )}
        {!isArchived && (
          <Btn size="sm" variant="ghost" icon={<Trash2 size={11} />} disabled={isBusy} onClick={() => onAction(detail.id, 'archive')}>
            {t.archive}
          </Btn>
        )}
      </div>

      {/* Per-task tools — log / context / edit-on-done. The MD-doc browser
          used to live here as its own button, but inline path clicks (in the
          body / result blocks) cover the common case directly, so we don't
          need a standalone entry point. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Btn size="sm" variant="ghost" icon={<Terminal size={11} />} onClick={onShowLog}>
          {t.logLoad}
        </Btn>
        <Btn size="sm" variant="ghost" icon={<BookOpen size={11} />} onClick={onShowContext}>
          {t.contextLoad}
        </Btn>
        {isDone && (
          <Btn size="sm" variant="ghost" icon={<Pencil size={11} />} onClick={onShowEdit}>
            {t.editOpen}
          </Btn>
        )}
      </div>

      {/* Result preview — render the current `result` as Markdown so deep
          reports stashed by alpha-labs/researcher workers are immediately
          legible without opening the edit dialog. We also pre-process the
          source to turn absolute MD paths into clickable links (handled by
          the wrapper's onClick capture below). */}
      {(isDone || (detail.result && detail.result.trim())) && (
        <Section title={t.mdResultHeader}>
          {detail.result && detail.result.trim() ? (
            <div
              style={{
                padding: 10,
                border: '1px solid var(--hairline)', borderRadius: 8,
                background: 'var(--bg-soft)',
                maxHeight: 320, overflowY: 'auto',
              }}
              onClick={(e) => {
                // Catch clicks on the synthetic links emitted by
                // linkifyMdPaths. Walk up via closest('a') because the click
                // can land on a child text node inside the anchor.
                const target = e.target as HTMLElement | null;
                if (!target) return;
                const anchor = target.closest?.('a');
                if (!anchor) return;
                const href = anchor.getAttribute('href') || '';
                if (!href.startsWith(MD_LINK_HREF_PREFIX)) return;
                e.preventDefault();
                e.stopPropagation();
                try {
                  const rel = decodeURIComponent(href.slice(MD_LINK_HREF_PREFIX.length));
                  onShowMarkdown(rel);
                } catch {
                  // Malformed fragment — silently noop.
                }
              }}
            >
              <MessageContent content={linkifyMdPaths(detail.result, detail.workspacePath)} />
            </div>
          ) : (
            <Empty text={t.mdResultEmpty} />
          )}
        </Section>
      )}

      {assignOpen && (
        <div style={{
          padding: 10,
          border: '1px solid var(--hairline)',
          borderRadius: 8,
          background: 'var(--bg-soft)',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          {profiles.length === 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.pickProfile}</span>}
          {profiles.map((p) => (
            <Btn
              key={p}
              size="sm"
              variant={detail.assignee === p ? 'primary' : 'default'}
              disabled={isBusy}
              onClick={() => { setAssignOpen(false); void onAssign(detail.id, p); }}
            >
              {p === activeProfile ? `★ ${p}` : p}
            </Btn>
          ))}
          {detail.assignee && (
            <Btn size="sm" variant="ghost" disabled={isBusy} onClick={() => { setAssignOpen(false); void onAssign(detail.id, null); }}>
              {t.unassign}
            </Btn>
          )}
        </div>
      )}

      <Section title={t.linkTitle}>
        <DependenciesSection
          taskId={detail.id}
          parents={detail.parents || []}
          children={detail.children || []}
          allTaskIds={allTaskIds}
          isBusy={isBusy}
          labels={{
            sectionParents: t.sectionParents,
            sectionChildren: t.sectionChildren,
            linkAdd: t.linkAdd,
            linkChildPlaceholder: t.linkChildPlaceholder,
            linkRemove: t.linkRemove,
            linkSelf: t.linkSelf,
            linkInvalid: t.linkInvalid,
          }}
          onLink={onLink}
          onUnlink={onUnlink}
          onJump={onJump}
        />
      </Section>

      <Section title={t.taskHistory}>
        {detail.events.length === 0 ? (
          <Empty text={t.noEvents} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {detail.events.slice(0, 80).map((ev) => (
              <div key={ev.id} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--muted)',
                display: 'flex',
                gap: 6,
                lineHeight: 1.5,
              }}>
                <span style={{ color: 'var(--muted-2)', flexShrink: 0 }}>{relTime(ev.createdAt)}</span>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{ev.kind}</span>
                {ev.payload != null && (
                  <span style={{
                    color: 'var(--muted-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}>{typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload).slice(0, 200)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t.runs}>
        {detail.runs.length === 0 ? (
          <Empty text={t.noRuns} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {detail.runs.slice(0, 8).map((run) => (
              <div key={run.id} style={{
                fontSize: 11.5,
                color: 'var(--muted)',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}>
                <Tag variant={run.outcome === 'completed' ? 'green' : run.outcome ? 'red' : 'cyan'}>{run.outcome || run.status}</Tag>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{run.profile || '—'}</span>
                <span style={{ color: 'var(--muted-2)' }}>{relTime(run.startedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t.comment}>
        {detail.comments.length === 0 ? (
          <Empty text={t.noComments} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {detail.comments.map((c) => (
              <div key={c.id} style={{
                padding: '6px 8px',
                background: 'var(--bg-soft)',
                borderRadius: 6,
                border: '1px solid var(--hairline)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 550 }}>{c.author}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>{relTime(c.createdAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            type="text"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder={t.writeComment}
            disabled={isBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commentDraft.trim()) {
                e.preventDefault();
                void onComment(detail.id, commentDraft).then(() => setCommentDraft(''));
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 30,
              padding: '0 10px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--bg-soft)',
              color: 'var(--text)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
            }}
          />
          <Btn
            size="sm"
            variant="primary"
            icon={<Send size={11} />}
            disabled={isBusy || !commentDraft.trim()}
            onClick={() => { void onComment(detail.id, commentDraft).then(() => setCommentDraft('')); }}
          >
            {t.addComment}
          </Btn>
        </div>
      </Section>
    </Card>
  );
}

function MetaGrid({ t, task }: { t: DetailLabels; task: KanbanTaskDetail }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (task.createdAt) rows.push({ label: t.created, value: relTime(task.createdAt) });
  if (task.startedAt) rows.push({ label: t.started, value: relTime(task.startedAt) });
  if (task.completedAt) rows.push({ label: t.completed, value: relTime(task.completedAt) });
  if (task.lastHeartbeatAt) rows.push({ label: t.heartbeat, value: relTime(task.lastHeartbeatAt) });
  if (task.workerPid) rows.push({ label: t.worker, value: String(task.workerPid) });
  if ((task.consecutiveFailures || 0) > 0) rows.push({ label: t.retry, value: String(task.consecutiveFailures) });
  if (task.workspaceKind) rows.push({ label: 'Workspace', value: task.workspacePath ? `${task.workspaceKind}: ${task.workspacePath}` : task.workspaceKind });
  if ((task.skills || []).length) rows.push({ label: 'Skills', value: (task.skills || []).join(', ') });
  // parents / children are rendered in the dedicated Dependencies section now

  if (rows.length === 0) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: '4px 12px',
      fontSize: 11,
      color: 'var(--muted)',
      padding: '6px 0',
      borderTop: '1px solid var(--hairline)',
      borderBottom: '1px solid var(--hairline)',
    }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <span style={{ color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{row.label}</span>
          <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        type="button"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'transparent', border: 0, padding: 0,
          cursor: 'pointer', color: 'var(--muted-2)',
          fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 500,
          marginBottom: 6,
        }}
      >
        <ChevronDown size={11} style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 200ms' }} />
        {title}
      </button>
      {open && children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{text}</div>;
}

// ─── CreateDialog ───────────────────────────────────────────────────────

interface CreateLabels {
  newTask: string;
  taskTitle: string;
  taskBody: string;
  assignee: string;
  priority: string;
  workspace: string;
  ws_scratch: string;
  ws_pinned: string;
  ws_session: string;
  wsPath: string;
  submit: string;
  cancel: string;
  saving: string;
  titleRequired: string;
}

function CreateDialog({
  t, profiles, activeProfile, onCancel, onSubmit,
}: {
  t: CreateLabels;
  profiles: string[];
  activeProfile: string;
  onCancel: () => void;
  onSubmit: (input: Parameters<typeof deckApi.kanbanTaskCreate>[1]) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState<string>(activeProfile || '');
  const [priority, setPriority] = useState<number>(0);
  const [wsKind, setWsKind] = useState<'scratch' | 'worktree' | 'session'>('scratch');
  const [wsPath, setWsPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim()) { setError(t.titleRequired); return; }
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        body: body.trim() || undefined,
        assignee: assignee || undefined,
        priority,
        workspaceKind: wsKind,
        workspacePath: wsKind !== 'scratch' && wsPath.trim() ? wsPath.trim() : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={t.newTask}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'color-mix(in oklch, var(--strong-text) 18%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus size={14} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 14, margin: 0, color: 'var(--strong-text)' }}>{t.newTask}</h2>
          <button onClick={onCancel} aria-label="close" style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>

        <Field label={t.taskTitle}>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            style={inputStyle}
          />
        </Field>

        <Field label={t.taskBody}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            disabled={saving}
            style={{ ...inputStyle, height: 'auto', minHeight: 72, resize: 'vertical' as const }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label={t.assignee}>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={saving} style={inputStyle}>
              <option value="">—</option>
              {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>

          <Field label={t.priority}>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              disabled={saving}
              style={inputStyle}
              min={-100}
              max={100}
            />
          </Field>
        </div>

        <Field label={t.workspace}>
          <select value={wsKind} onChange={(e) => setWsKind(e.target.value as 'scratch' | 'worktree' | 'session')} disabled={saving} style={inputStyle}>
            <option value="scratch">{t.ws_scratch}</option>
            <option value="worktree">{t.ws_pinned}</option>
            <option value="session">{t.ws_session}</option>
          </select>
        </Field>

        {wsKind !== 'scratch' && (
          <Field label={t.wsPath}>
            <input
              type="text"
              value={wsPath}
              onChange={(e) => setWsPath(e.target.value)}
              placeholder="/path/to/repo"
              disabled={saving}
              style={inputStyle}
            />
          </Field>
        )}

        {error && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
          <Btn variant="ghost" onClick={onCancel} disabled={saving}>{t.cancel}</Btn>
          <Btn variant="primary" icon={saving ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} disabled={saving || !title.trim()} onClick={submit}>
            {saving ? t.saving : t.submit}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--bg-soft)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

// ─── DependenciesSection ────────────────────────────────────────────────

const TASK_ID_RE_CLIENT = /^[A-Za-z0-9_-]{1,64}$/;

function DependenciesSection({
  taskId, parents, children, allTaskIds, isBusy, labels,
  onLink, onUnlink, onJump,
}: {
  taskId: string;
  parents: string[];
  children: string[];
  allTaskIds: string[];
  isBusy: boolean;
  labels: { sectionParents: string; sectionChildren: string; linkAdd: string; linkChildPlaceholder: string; linkRemove: string; linkSelf: string; linkInvalid: string };
  onLink: (parentId: string, childId: string) => Promise<void>;
  onUnlink: (parentId: string, childId: string) => Promise<void>;
  onJump: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const knownIds = useMemo(() => new Set(allTaskIds), [allTaskIds]);

  const submit = async () => {
    const child = draft.trim();
    setError('');
    if (!child) return;
    if (!TASK_ID_RE_CLIENT.test(child)) { setError(labels.linkInvalid); return; }
    if (child === taskId) { setError(labels.linkSelf); return; }
    try {
      await onLink(taskId, child);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {parents.length > 0 && (
        <DepRow
          label={labels.sectionParents}
          ids={parents}
          known={knownIds}
          onJump={onJump}
        />
      )}
      <DepRow
        label={labels.sectionChildren}
        ids={children}
        known={knownIds}
        onJump={onJump}
        removable
        isBusy={isBusy}
        onUnlink={(childId) => onUnlink(taskId, childId)}
        labelRemove={labels.linkRemove}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={labels.linkChildPlaceholder}
          disabled={isBusy}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          style={{
            flex: 1, minWidth: 0, height: 28,
            padding: '0 10px', borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--bg-soft)', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
          }}
        />
        <Btn size="sm" variant="default" icon={<Link2 size={11} />} disabled={isBusy || !draft.trim()} onClick={submit}>
          {labels.linkAdd}
        </Btn>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}

function DepRow({
  label, ids, known, onJump, removable, isBusy, onUnlink, labelRemove,
}: {
  label: string;
  ids: string[];
  known: Set<string>;
  onJump: (id: string) => void;
  removable?: boolean;
  isBusy?: boolean;
  onUnlink?: (id: string) => Promise<void> | void;
  labelRemove?: string;
}) {
  if (ids.length === 0 && !removable) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {label}
      </span>
      {ids.length === 0 ? (
        <Empty text="—" />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ids.map((id) => (
            <span key={id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 6px',
              borderRadius: 6,
              border: '1px solid var(--hairline)',
              background: 'var(--bg-soft)',
              fontFamily: 'var(--font-mono)', fontSize: 10.5,
              color: known.has(id) ? 'var(--text)' : 'var(--muted-2)',
            }}>
              <button
                type="button"
                onClick={() => onJump(id)}
                disabled={!known.has(id)}
                style={{
                  background: 'transparent', border: 0, padding: 0,
                  font: 'inherit', color: 'inherit',
                  cursor: known.has(id) ? 'pointer' : 'default',
                  textDecoration: known.has(id) ? 'underline dotted' : 'none',
                }}
                title={known.has(id) ? id : `${id} (not on this board)`}
              >{id}</button>
              {removable && (
                <button
                  type="button"
                  onClick={() => { void onUnlink?.(id); }}
                  disabled={isBusy}
                  aria-label={labelRemove}
                  title={labelRemove}
                  style={{
                    background: 'transparent', border: 0, padding: 0,
                    color: 'var(--muted-2)', cursor: 'pointer', display: 'inline-flex',
                  }}
                >
                  <Unlink size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LogModal / ContextModal / EditDialog ──────────────────────────────

interface ModalLabels {
  logTitle: string;
  logEmpty: string;
  logRefresh: string;
  contextTitle: string;
  contextEmpty: string;
  cancel: string;
}

function LogModal({ board, taskId, t, onClose }: { board: string; taskId: string; t: ModalLabels; onClose: () => void }) {
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await deckApi.kanbanTaskLog(board, taskId);
      setText(r.log || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [board, taskId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ModalShell title={`${t.logTitle} · ${taskId}`} onClose={onClose} icon={<Terminal size={14} />} extra={
      <Btn size="sm" variant="ghost" icon={<RotateCw size={11} />} onClick={load} disabled={loading}>
        {t.logRefresh}
      </Btn>
    }>
      {loading ? (
        <ModalLoading />
      ) : err ? (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>
      ) : !text.trim() ? (
        <div style={{ fontSize: 12, color: 'var(--muted-2)', padding: '24px 8px', textAlign: 'center' }}>{t.logEmpty}</div>
      ) : (
        <pre style={{
          margin: 0, padding: 12,
          background: 'var(--bg-soft)', border: '1px solid var(--hairline)', borderRadius: 8,
          fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5,
          color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: '60vh', overflowY: 'auto',
        }}>{text}</pre>
      )}
    </ModalShell>
  );
}

function ContextModal({ board, taskId, t, onClose }: { board: string; taskId: string; t: ModalLabels; onClose: () => void }) {
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deckApi.kanbanTaskContext(board, taskId)
      .then((r) => { if (!cancelled) setText(r.context || ''); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [board, taskId]);

  return (
    <ModalShell title={`${t.contextTitle} · ${taskId}`} onClose={onClose} icon={<BookOpen size={14} />}>
      {loading ? (
        <ModalLoading />
      ) : err ? (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>
      ) : !text.trim() ? (
        <div style={{ fontSize: 12, color: 'var(--muted-2)', padding: '24px 8px', textAlign: 'center' }}>{t.contextEmpty}</div>
      ) : (
        <pre style={{
          margin: 0, padding: 12,
          background: 'var(--bg-soft)', border: '1px solid var(--hairline)', borderRadius: 8,
          fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5,
          color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: '60vh', overflowY: 'auto',
        }}>{text}</pre>
      )}
    </ModalShell>
  );
}

interface EditLabels {
  editTitle: string;
  editResult: string;
  editSummary: string;
  editMetadata: string;
  editSubmit: string;
  cancel: string;
  saving: string;
}

function EditDialog({
  t, taskId, initial, onCancel, onSubmit,
}: {
  t: EditLabels;
  taskId: string;
  initial: { result: string; summary?: string };
  onCancel: () => void;
  onSubmit: (body: { result: string; summary?: string; metadata?: unknown }) => Promise<void>;
}) {
  const [result, setResult] = useState(initial.result || '');
  const [summary, setSummary] = useState(initial.summary || '');
  const [metadata, setMetadata] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!result.trim()) { setErr('result required'); return; }
    let parsedMeta: unknown = undefined;
    if (metadata.trim()) {
      try { parsedMeta = JSON.parse(metadata); }
      catch { setErr('Invalid JSON in metadata'); return; }
    }
    setSaving(true);
    try {
      await onSubmit({
        result: result.trim(),
        summary: summary.trim() || undefined,
        metadata: parsedMeta,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`${t.editTitle} · ${taskId}`} onClose={onCancel} icon={<Pencil size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label={t.editResult}>
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            rows={5}
            disabled={saving}
            style={{ ...inputStyle, height: 'auto', minHeight: 100, resize: 'vertical' as const, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
        <Field label={t.editSummary}>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            disabled={saving}
            style={{ ...inputStyle, height: 'auto', minHeight: 50, resize: 'vertical' as const }}
          />
        </Field>
        <Field label={t.editMetadata}>
          <textarea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            placeholder='{"key": "value"}'
            rows={3}
            disabled={saving}
            style={{ ...inputStyle, height: 'auto', minHeight: 60, resize: 'vertical' as const, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
        {err && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel} disabled={saving}>{t.cancel}</Btn>
          <Btn variant="primary" icon={saving ? <Loader2 size={12} className="spin" /> : <Pencil size={12} />} disabled={saving || !result.trim()} onClick={submit}>
            {saving ? t.saving : t.editSubmit}
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, icon, onClose, extra, wide, children }: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  extra?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'color-mix(in oklch, var(--strong-text) 18%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // `wide` is currently only used by MarkdownModal. We size it close
          // to the viewport so long markdown reports get real reading room
          // without resorting to horizontal scroll.
          width: wide ? 'min(1400px, 95vw)' : 'min(720px, 100%)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: '95vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}
          <h2 style={{ fontSize: 14, margin: 0, color: 'var(--strong-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
          {extra && <div style={{ marginLeft: 8 }}>{extra}</div>}
          <button onClick={onClose} aria-label="close" style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, color: 'var(--muted-2)', gap: 6 }}>
      <Loader2 size={14} className="spin" /> Loading…
    </div>
  );
}

// ─── MarkdownModal ──────────────────────────────────────────────────────

// ─── MD path linkification ──────────────────────────────────────────────
//
// Researcher / alpha-labs workers commonly drop absolute *.md report paths
// into a task's body or result text, e.g.
//
//   Deep report: /Users/foo/Hermes_Sync/AlphaLabs/reports/x.md
//
// The user wants to click those paths and open the file directly, instead
// of bouncing through a "Browse MD docs" button. We achieve this two ways:
//
//   - For the **body** (rendered as plain text, pre-wrap) we split the
//     string into segments and render each match as a real <button>.
//   - For the **result** (rendered as Markdown via MessageContent) we
//     pre-process the source text and rewrite each match into a markdown
//     link with a private fragment href; the parent <div> intercepts the
//     resulting <a> click before the browser can navigate.
//
// In both cases we only linkify paths that fall inside an allowed Markdown
// root, and display a human-readable document title instead of the raw path.

// Conservative path matcher: starts with `/`, ends in `.md`, doesn't swallow
// trailing punctuation or markdown delimiters.
const MD_PATH_RE = /(\/(?:[^\s)\]'"`<>,;]+)\.md)\b/g;

const MD_LINK_HREF_PREFIX = '#hermes-md::';
const ALPHA_LABS_WORKSPACE_ROOT = '/Users/fanxuxin/Hermes_Sync/AlphaLabs';

function isReadableMdPath(absPath: string, workspacePath?: string | null): boolean {
  const p = absPath.replace(/\/+$/, '');
  const roots = [workspacePath, ALPHA_LABS_WORKSPACE_ROOT]
    .filter(Boolean)
    .map((root) => String(root).replace(/\/+$/, ''));
  return roots.some((root) => p.startsWith(root + '/'));
}

function markdownModalPath(absPath: string, workspacePath?: string | null): string {
  const ws = workspacePath ? workspacePath.replace(/\/+$/, '') : '';
  if (ws && absPath.startsWith(ws + '/')) return absPath.slice(ws.length + 1);
  // Keep absolute Alpha Labs canonical paths absolute. The API accepts absolute
  // paths only if they are inside an allowed root, which lets older approval
  // cards with missing/scratch workspace metadata still open their report docs.
  return absPath;
}

function markdownLinkLabel(absPath: string): string {
  const rawName = absPath.split('/').pop() || absPath;
  let stem = rawName.replace(/\.md$/i, '');
  const isExperiment = absPath.includes('/reports/experiments/') || /^exp[-_]/i.test(stem);
  const isOpportunity = absPath.includes('/reports/opportunities/');

  stem = stem
    .replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]/, '')
    .replace(/^exp[-_]/i, '')
    .replace(/[-_]\d{8}$/, '')
    .replace(/^(?:s|a\+?|a-|b|c|kill)[-_]/i, '');

  const zhTitleOverrides: Record<string, string> = {
    'google-merchant-feed-disapproval-rescue': 'Google 商家中心商品数据源拒登救援',
    'google-merchant-feed-disapproval-rescue-agent': 'Google 商家中心商品数据源拒登救援智能体',
  };
  const normalizedStem = stem.toLowerCase().replace(/_/g, '-');
  const zhOverride = zhTitleOverrides[normalizedStem];
  if (zhOverride) {
    if (isExperiment) return `实验草案｜${zhOverride}`;
    if (isOpportunity) return `深度报告｜${zhOverride}`;
    return `Markdown｜${zhOverride}`;
  }

  const acronyms = new Set([
    'ai', 'api', 'ap', 'ar', 'b2b', 'cbam', 'cpg', 'dds', 'dora', 'eudr',
    'fda', 'geo', 'gtin', 'hts', 'ict', 'llm', 'mcp', 'pfas', 'qa', 'ria',
    'sbom', 'sec', 'seo', 'tsca', 'ui', 'ux', 'vat', 'xml', 'csv', 'pdf',
  ]);
  const title = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      if (/^v\d+$/i.test(token)) return token.toUpperCase();
      if (/^\d/.test(token)) return token;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .trim() || rawName;

  if (isExperiment) return `实验草案｜${title}`;
  if (isOpportunity) return `深度报告｜${title}`;
  return `Markdown｜${title}`;
}

function linkifyMdPaths(text: string, workspacePath?: string | null): string {
  if (!text) return text;
  return text.replace(MD_PATH_RE, (full, p) => {
    if (typeof p !== 'string') return full;
    if (!isReadableMdPath(p, workspacePath)) return full;
    const target = markdownModalPath(p, workspacePath);
    if (!target) return full;
    return `[${markdownLinkLabel(p)}](${MD_LINK_HREF_PREFIX}${encodeURIComponent(target)})`;
  });
}

function BodyWithMdLinks({
  text, workspacePath, onOpenMd,
}: {
  text: string;
  workspacePath?: string | null;
  onOpenMd: (initialFile?: string) => void;
}) {
  const segments = useMemo(() => {
    const out: Array<{ kind: 'text'; value: string } | { kind: 'link'; abs: string; rel: string; label: string }> = [];
    if (!text) return out;
    // Fresh RegExp instance — sharing a /g regex across calls leaks lastIndex
    // between renders.
    const re = new RegExp(MD_PATH_RE.source, 'g');
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
      const abs = m[1]!;
      if (isReadableMdPath(abs, workspacePath)) {
        out.push({ kind: 'link', abs, rel: markdownModalPath(abs, workspacePath), label: markdownLinkLabel(abs) });
      } else {
        out.push({ kind: 'text', value: abs });
      }
      last = m.index + abs.length;
    }
    if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
    return out;
  }, [text, workspacePath]);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) => seg.kind === 'text' ? (
        <span key={i}>{seg.value}</span>
      ) : (
        <button
          key={i}
          type="button"
          onClick={() => onOpenMd(seg.rel)}
          title={seg.abs}
          style={{
            background: 'transparent', border: 0, padding: 0, margin: 0,
            color: 'var(--accent)', textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
            wordBreak: 'break-all',
            display: 'inline',
          }}
        >
          {seg.label}
        </button>
      ))}
    </>
  );
}

interface MdModalLabels {
  mdTitle: string;
  mdEmpty: string;
  mdNoWorkspace: string;
  mdEdit: string;
  mdPreview: string;
  mdSave: string;
  mdSaving: string;
  mdSaved: string;
  mdConflict: string;
  mdReload: string;
  mdSelectHint: string;
  mdShowFiles: string;
  mdHideFiles: string;
  cancel: string;
}

function MarkdownModal({ board, taskId, t, initialFile, onClose }: { board: string; taskId: string; t: MdModalLabels; initialFile?: string; onClose: () => void }) {
  const [list, setList] = useState<KanbanMarkdownEntry[]>([]);
  const [root, setRoot] = useState<string>('');
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string>('');
  // Pre-seed `active` with the file the user clicked. The right pane will
  // start fetching that file even before the listing comes back.
  const [active, setActive] = useState<string>(initialFile || '');
  // Sidebar (file list rail) is hidden by default — the common flow is to
  // open the modal via an inline path click, in which case the user already
  // knows which file they want and the rail is just visual noise.
  const [showSidebar, setShowSidebar] = useState<boolean>(false);

  // Per-file editor state — text comes from the server, edited becomes the
  // working draft, dirty + saving + savedTick drive the toolbar / hint area.
  const [text, setText] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  // Optimistic-lock token: the epoch-seconds mtime from the last successful
  // read or save. Sent back on the next save so the server can 409 if a
  // worker rewrote the file underneath us. null = unknown (e.g. a failed
  // load) → the save proceeds without the check.
  const [mtime, setMtime] = useState<number | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileErr, setFileErr] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListErr('');
    try {
      const r = await deckApi.kanbanMarkdownList(board, taskId);
      setList(r.entries || []);
      setRoot(r.root || '');
      // Auto-select the most recently modified file ONLY when the user didn't
      // arrive via an inline path click — initialFile takes precedence so we
      // don't overwrite their explicit choice with "newest".
      if (!active && !initialFile && (r.entries || []).length > 0) {
        const sorted = [...r.entries].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        setActive(sorted[0]!.path);
      }
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, [board, taskId, active, initialFile]);

  useEffect(() => { void loadList(); }, [loadList]);

  // Whenever the user picks a different file, fetch its content and reset the
  // edit buffer. Re-fetch on Reload too.
  const loadFile = useCallback(async (path: string) => {
    if (!path) return;
    setFileLoading(true);
    setFileErr('');
    try {
      const r = await deckApi.kanbanMarkdownFile(board, taskId, path);
      setText(r.content || '');
      setDraft(r.content || '');
      setMtime(typeof r.mtime === 'number' ? r.mtime : null);
      setEditing(false);
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : String(e));
      setText('');
      setDraft('');
      setMtime(null);
    } finally {
      setFileLoading(false);
    }
  }, [board, taskId]);

  useEffect(() => {
    if (active) void loadFile(active);
  }, [active, loadFile]);

  const dirty = draft !== text;

  const onSave = async () => {
    if (!active || !dirty) return;
    setSaving(true);
    setFileErr('');
    try {
      const res = await deckApi.kanbanMarkdownSave(board, taskId, active, draft, mtime ?? undefined);
      setText(draft);
      setMtime(typeof res.mtime === 'number' ? res.mtime : null);
      setSavedTick((x) => x + 1);
      // Refresh the listing so size / mtime stays accurate.
      void loadList();
    } catch (e) {
      // 409 = the file changed on disk since we last read it. Surface a clear
      // reload-first message instead of the raw error code.
      if (e instanceof ApiError && e.status === 409) {
        setFileErr(t.mdConflict);
      } else {
        setFileErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  // Auto-clear the "saved" hint after a couple seconds.
  useEffect(() => {
    if (!savedTick) return;
    const tid = setTimeout(() => setSavedTick(0), 2000);
    return () => clearTimeout(tid);
  }, [savedTick]);

  // Keyboard: ⌘/Ctrl-S saves while focused inside the modal.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (active && editing && dirty && !saving) {
          e.preventDefault();
          void onSave();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onSave is recreated each render; we just want the latest closure
  }, [active, editing, dirty, saving, draft, mtime]);

  return (
    <ModalShell
      title={`${t.mdTitle} · ${taskId}`}
      onClose={onClose}
      icon={<FileText size={14} />}
      wide
      extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Btn
            size="sm"
            variant="ghost"
            icon={showSidebar ? <PanelLeftClose size={11} /> : <PanelLeftOpen size={11} />}
            onClick={() => setShowSidebar((v) => !v)}
          >
            {showSidebar ? t.mdHideFiles : t.mdShowFiles}
            {!showSidebar && list.length > 0 && (
              <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--muted-2)' }}>· {list.length}</span>
            )}
          </Btn>
          <Btn size="sm" variant="ghost" icon={<RotateCw size={11} />} onClick={loadList} disabled={listLoading}>
            {t.mdReload}
          </Btn>
        </div>
      }
    >
      {listLoading ? (
        <ModalLoading />
      ) : listErr ? (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{listErr}</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted-2)', padding: '24px 8px', textAlign: 'center' }}>
          {root ? t.mdEmpty : t.mdNoWorkspace}
          {root && <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 6, color: 'var(--muted)' }}>{root}</div>}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          // Two columns when the rail is visible, single column otherwise.
          // The conditional grid keeps the right pane symmetrical instead of
          // leaving an awkward empty gutter when sidebar is hidden.
          gridTemplateColumns: showSidebar ? 'minmax(240px, 320px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 12,
          minHeight: 480,
        }}>
          {showSidebar && (
            /* File list — left rail */
            <div style={{
              border: '1px solid var(--hairline)', borderRadius: 8,
              background: 'var(--bg-soft)',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '6px 10px',
                fontSize: 10.5, fontFamily: 'var(--font-mono)',
                color: 'var(--muted-2)',
                borderBottom: '1px solid var(--hairline)',
                wordBreak: 'break-all',
              }}>{root}</div>
              <div style={{ overflowY: 'auto', maxHeight: '78vh' }}>
                {list.map((ent) => (
                  <button
                    key={ent.path}
                    type="button"
                    onClick={() => setActive(ent.path)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      width: '100%', textAlign: 'left',
                      padding: '8px 10px',
                      border: 0, borderBottom: '1px solid var(--hairline)',
                      background: active === ent.path ? 'var(--accent-soft)' : 'transparent',
                      color: active === ent.path ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer',
                      font: 'inherit', fontSize: 11.5,
                    }}
                  >
                    <span style={{ fontWeight: 550, wordBreak: 'break-all' }}>{ent.path}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
                      {formatBytes(ent.size)}{ent.mtime ? ` · ${relTime(new Date(ent.mtime * 1000).toISOString())}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* File preview / editor — right pane */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 480 }}>
            {!active ? (
              <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center', padding: '40px 10px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <span>{showSidebar ? t.mdSelectHint : t.mdShowFiles}</span>
                {!showSidebar && (
                  <Btn size="sm" variant="ghost" icon={<PanelLeftOpen size={11} />} onClick={() => setShowSidebar(true)}>
                    {t.mdShowFiles}
                  </Btn>
                )}
              </div>
            ) : (
              <>
                {/* Active file path — visible regardless of sidebar state, so
                    the user always knows what they're viewing. */}
                <div style={{
                  fontSize: 11, fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-2)',
                  padding: '4px 8px',
                  background: 'var(--bg-soft)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 6,
                  wordBreak: 'break-all',
                }}>{root ? (active.startsWith('/') ? active : `${root}/${active}`) : active}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Btn
                    size="sm"
                    variant={editing ? 'default' : 'ghost'}
                    icon={editing ? <Eye size={11} /> : <Pencil size={11} />}
                    onClick={() => setEditing((v) => !v)}
                    disabled={fileLoading}
                  >
                    {editing ? t.mdPreview : t.mdEdit}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    icon={<RotateCw size={11} />}
                    onClick={() => loadFile(active)}
                    disabled={fileLoading}
                  >
                    {t.mdReload}
                  </Btn>
                  {editing && (
                    <Btn
                      size="sm"
                      variant="primary"
                      icon={saving ? <Loader2 size={11} className="spin" /> : <Save size={11} />}
                      onClick={onSave}
                      disabled={!dirty || saving}
                    >
                      {saving ? t.mdSaving : t.mdSave}
                    </Btn>
                  )}
                  {savedTick > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {t.mdSaved}</span>
                  )}
                  {dirty && !saving && (
                    <span style={{ fontSize: 11, color: 'var(--yellow)' }}>•</span>
                  )}
                </div>
                {fileErr && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>{fileErr}</div>}
                {fileLoading ? (
                  <ModalLoading />
                ) : editing ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    style={{
                      width: '100%', minHeight: 480, maxHeight: '78vh',
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: 'var(--bg-soft)',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55,
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <div style={{
                    padding: 14,
                    borderRadius: 8,
                    border: '1px solid var(--hairline)',
                    background: 'var(--bg-soft)',
                    overflowY: 'auto',
                    minHeight: 480,
                    maxHeight: '78vh',
                  }}>
                    {text.trim() ? (
                      <MessageContent content={text} />
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
