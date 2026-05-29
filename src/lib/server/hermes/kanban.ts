import type {
  KanbanBoard,
  KanbanBoardSnapshot,
  KanbanTask,
  KanbanTaskDetail,
  KanbanDiagnostic,
  KanbanStats,
  KanbanAssignee,
  KanbanMarkdownListResult,
  KanbanMarkdownFile,
} from '@/lib/types';
import { runPython } from '../run-python';
import { execFileAsync } from './core';
import { spawn } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

// Kanban data lives at:
//   default board → ~/.hermes/kanban.db (legacy / back-compat path)
//   other boards  → ~/.hermes/kanban/boards/<slug>/kanban.db
//
// Legacy retention / sunset: the default-board legacy path is deliberately
// preserved so existing ~/.hermes/kanban.db boards continue to load. Do not
// migrate/delete it until Hermes CLI itself stops creating or reading that DB.
//
// Reads go through SQLite directly (matches the pattern used for sessions /
// messages / runs — much faster than shelling to the CLI for every list).
// Writes shell out to `hermes kanban` so dispatcher events, lock files and
// notify subscribers stay consistent with what the gateway expects.

// Slug allowlist matches Hermes's `_normalize_board_slug`: lowercase
// alphanumerics, dash and underscore. Reject anything else outright — the slug
// gets passed to the CLI and used to construct filesystem paths.
const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeBoard(board: string | undefined | null): string {
  if (!board) return 'default';
  return BOARD_SLUG_RE.test(board) ? board : 'default';
}

function assertTaskId(id: string): void {
  if (!TASK_ID_RE.test(id)) throw new Error('invalid_task_id');
}

const LIST_BOARDS_SCRIPT = String.raw`
import json, os, pathlib, sqlite3, datetime

home = pathlib.Path.home() / '.hermes'
boards_root = home / 'kanban' / 'boards'
default_db = home / 'kanban.db'

def to_iso(v):
    if v in (None, ''): return None
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        pass
    s = str(v)
    return s

def read_meta(slug, meta_path):
    meta = {
        'slug': slug,
        'name': ' '.join(p.capitalize() for p in slug.replace('_','-').split('-') if p) or slug,
        'description': '',
        'icon': '',
        'color': '',
        'created_at': None,
        'archived': False,
    }
    try:
        if meta_path.exists():
            raw = json.loads(meta_path.read_text(encoding='utf-8'))
            if isinstance(raw, dict):
                raw['slug'] = slug
                meta.update(raw)
    except (OSError, json.JSONDecodeError):
        pass
    return meta

def count_db(db_path):
    counts = {'triage':0,'todo':0,'ready':0,'running':0,'blocked':0,'done':0,'archived':0,'total':0}
    try:
        if not db_path.exists(): return counts
        # immutable=1 because kanban.db has no WAL sidecar (rollback-journal
        # mode); plain mode=ro fails to open when a writer process holds a fd.
        # We re-open per request, so a stale snapshot window is at most one poll.
        con = sqlite3.connect(f'file:{db_path}?mode=ro&immutable=1', uri=True)
        try:
            for row in con.execute('select status, count(*) c from tasks group by status'):
                st, c = row
                counts['total'] += int(c)
                key = (st or '').lower()
                if key in counts: counts[key] = int(c)
        finally:
            con.close()
    except sqlite3.Error:
        pass
    return counts

# Active board pointer at <root>/kanban/current (a small text file with the slug).
active_slug = 'default'
try:
    cur = home / 'kanban' / 'current'
    if cur.exists():
        s = cur.read_text(encoding='utf-8').strip()
        if s: active_slug = s
except OSError:
    pass

boards = []
# Always include default.
default_meta = read_meta('default', boards_root / 'default' / 'board.json' if boards_root.exists() else home / 'kanban' / 'boards' / 'default' / 'board.json')
default_meta['db_path'] = str(default_db)
default_meta['counts'] = count_db(default_db)
default_meta['active'] = (active_slug == 'default')
boards.append(default_meta)

if boards_root.exists():
    for child in sorted(boards_root.iterdir()):
        if not child.is_dir(): continue
        slug = child.name
        if slug == 'default': continue
        db = child / 'kanban.db'
        meta = read_meta(slug, child / 'board.json')
        meta['db_path'] = str(db)
        meta['counts'] = count_db(db)
        meta['active'] = (active_slug == slug)
        boards.append(meta)

print(json.dumps(boards, ensure_ascii=False))
`;

interface RawBoard {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  created_at?: number | string | null;
  archived?: boolean;
  db_path?: string;
  counts?: { triage: number; todo: number; ready: number; running: number; blocked: number; done: number; archived: number; total: number };
  active?: boolean;
}

function isoOrUndefined(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') {
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === 'string') {
    const num = Number(v);
    if (Number.isFinite(num) && num > 10_000_000) return new Date(num * 1000).toISOString();
    return v;
  }
  return undefined;
}

function shapeBoard(raw: RawBoard): KanbanBoard {
  return {
    slug: String(raw.slug),
    name: raw.name || raw.slug,
    description: raw.description || undefined,
    icon: raw.icon || undefined,
    color: raw.color || undefined,
    createdAt: isoOrUndefined(raw.created_at),
    archived: !!raw.archived,
    active: !!raw.active,
    counts: raw.counts,
  };
}

export async function getBoards(): Promise<KanbanBoard[]> {
  const r = await runPython<RawBoard[]>(LIST_BOARDS_SCRIPT, { timeoutMs: 6000 });
  if (!r.ok) throw new Error(`getBoards failed: ${r.error}`);
  return r.value.map(shapeBoard);
}

const LIST_TASKS_SCRIPT = String.raw`
import json, os, pathlib, sqlite3, datetime

home = pathlib.Path.home() / '.hermes'
slug = os.environ.get('BOARD','default')
if slug == 'default':
    db = home / 'kanban.db'
else:
    db = home / 'kanban' / 'boards' / slug / 'kanban.db'

def to_iso(v):
    if v in (None, ''): return None
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        pass
    return str(v)

out = {'tasks': [], 'board_meta': None}

if db.exists():
    con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
    con.row_factory = sqlite3.Row
    try:
        cols = [r[1] for r in con.execute('pragma table_info(tasks)').fetchall()]
        if cols:
            select_cols = [c for c in [
                'id','title','body','assignee','status','priority','created_by',
                'created_at','started_at','completed_at','workspace_kind','workspace_path',
                'tenant','result','spawn_failures','worker_pid','last_spawn_error',
                'last_heartbeat_at','consecutive_failures','last_failure_error','max_retries',
                'skills',
            ] if c in cols]
            rows = con.execute('select '+','.join(select_cols)+' from tasks order by priority desc, created_at desc').fetchall()
            # Build adjacency for parent/child links.
            children_by_parent = {}
            parents_by_child = {}
            try:
                for lr in con.execute('select parent_id, child_id from task_links').fetchall():
                    children_by_parent.setdefault(lr['parent_id'], []).append(lr['child_id'])
                    parents_by_child.setdefault(lr['child_id'], []).append(lr['parent_id'])
            except sqlite3.Error:
                pass
            for r in rows:
                d = dict(r)
                tid = str(d.get('id'))
                skills = []
                if d.get('skills'):
                    try:
                        parsed = json.loads(d.get('skills') or '[]')
                        if isinstance(parsed, list):
                            skills = [str(x) for x in parsed]
                    except json.JSONDecodeError:
                        pass
                out['tasks'].append({
                    'id': tid,
                    'title': d.get('title') or '',
                    'body': d.get('body') or '',
                    'status': d.get('status') or 'ready',
                    'assignee': d.get('assignee') or None,
                    'priority': int(d.get('priority') or 0),
                    'createdBy': d.get('created_by') or None,
                    'createdAt': to_iso(d.get('created_at')),
                    'startedAt': to_iso(d.get('started_at')),
                    'completedAt': to_iso(d.get('completed_at')),
                    'workspaceKind': d.get('workspace_kind') or None,
                    'workspacePath': d.get('workspace_path') or None,
                    'tenant': d.get('tenant') or None,
                    'result': d.get('result') or None,
                    'spawnFailures': d.get('spawn_failures') or 0,
                    'consecutiveFailures': d.get('consecutive_failures') or 0,
                    'lastFailureError': d.get('last_failure_error') or None,
                    'maxRetries': d.get('max_retries'),
                    'workerPid': d.get('worker_pid'),
                    'lastHeartbeatAt': to_iso(d.get('last_heartbeat_at')),
                    'parents': parents_by_child.get(tid, []),
                    'children': children_by_parent.get(tid, []),
                    'skills': skills,
                })
    finally:
        con.close()

print(json.dumps(out, ensure_ascii=False))
`;

interface RawTaskBundle {
  tasks: KanbanTask[];
  board_meta: unknown;
}

export async function getBoardSnapshot(boardSlug: string): Promise<KanbanBoardSnapshot> {
  const slug = safeBoard(boardSlug);
  const [boards, taskRes] = await Promise.all([
    getBoards(),
    runPython<RawTaskBundle>(LIST_TASKS_SCRIPT, { timeoutMs: 8000, env: { ...process.env, BOARD: slug } }),
  ]);
  if (!taskRes.ok) throw new Error(`getBoardSnapshot failed: ${taskRes.error}`);
  const board = boards.find((b) => b.slug === slug) || { slug, name: slug, active: false };
  return { board, tasks: taskRes.value.tasks || [] };
}

const TASK_DETAIL_SCRIPT = String.raw`
import json, os, pathlib, sqlite3, datetime

home = pathlib.Path.home() / '.hermes'
slug = os.environ.get('BOARD','default')
tid = os.environ.get('TASK_ID','')
if slug == 'default':
    db = home / 'kanban.db'
else:
    db = home / 'kanban' / 'boards' / slug / 'kanban.db'

def to_iso(v):
    if v in (None, ''): return None
    try:
        f = float(v)
        if f > 10_000_000:
            return datetime.datetime.fromtimestamp(f, tz=datetime.timezone.utc).isoformat().replace('+00:00','Z')
    except (TypeError, ValueError):
        pass
    return str(v)

result = {'task': None, 'comments': [], 'events': [], 'runs': []}

if tid and db.exists():
    con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
    con.row_factory = sqlite3.Row
    try:
        tcols = [r[1] for r in con.execute('pragma table_info(tasks)').fetchall()]
        if tcols:
            select_cols = [c for c in [
                'id','title','body','assignee','status','priority','created_by',
                'created_at','started_at','completed_at','workspace_kind','workspace_path',
                'tenant','result','spawn_failures','worker_pid','last_spawn_error',
                'last_heartbeat_at','consecutive_failures','last_failure_error','max_retries',
                'skills',
            ] if c in tcols]
            row = con.execute('select '+','.join(select_cols)+' from tasks where id=?', (tid,)).fetchone()
            if row:
                d = dict(row)
                skills = []
                if d.get('skills'):
                    try:
                        parsed = json.loads(d.get('skills') or '[]')
                        if isinstance(parsed, list):
                            skills = [str(x) for x in parsed]
                    except json.JSONDecodeError:
                        pass
                children = []
                parents = []
                try:
                    children = [r['child_id'] for r in con.execute('select child_id from task_links where parent_id=?', (tid,)).fetchall()]
                    parents = [r['parent_id'] for r in con.execute('select parent_id from task_links where child_id=?', (tid,)).fetchall()]
                except sqlite3.Error:
                    pass
                result['task'] = {
                    'id': str(d.get('id')),
                    'title': d.get('title') or '',
                    'body': d.get('body') or '',
                    'status': d.get('status') or 'ready',
                    'assignee': d.get('assignee') or None,
                    'priority': int(d.get('priority') or 0),
                    'createdBy': d.get('created_by') or None,
                    'createdAt': to_iso(d.get('created_at')),
                    'startedAt': to_iso(d.get('started_at')),
                    'completedAt': to_iso(d.get('completed_at')),
                    'workspaceKind': d.get('workspace_kind') or None,
                    'workspacePath': d.get('workspace_path') or None,
                    'tenant': d.get('tenant') or None,
                    'result': d.get('result') or None,
                    'spawnFailures': d.get('spawn_failures') or 0,
                    'consecutiveFailures': d.get('consecutive_failures') or 0,
                    'lastFailureError': d.get('last_failure_error') or None,
                    'maxRetries': d.get('max_retries'),
                    'workerPid': d.get('worker_pid'),
                    'lastHeartbeatAt': to_iso(d.get('last_heartbeat_at')),
                    'parents': parents,
                    'children': children,
                    'skills': skills,
                }
                try:
                    for cr in con.execute('select id, author, body, created_at from task_comments where task_id=? order by created_at asc', (tid,)).fetchall():
                        result['comments'].append({
                            'id': int(cr['id']),
                            'author': cr['author'] or '',
                            'body': cr['body'] or '',
                            'createdAt': to_iso(cr['created_at']) or '',
                        })
                except sqlite3.Error:
                    pass
                try:
                    for er in con.execute('select id, run_id, kind, payload, created_at from task_events where task_id=? order by id desc limit 200', (tid,)).fetchall():
                        payload = None
                        if er['payload']:
                            try:
                                payload = json.loads(er['payload'])
                            except (TypeError, json.JSONDecodeError):
                                payload = er['payload']
                        result['events'].append({
                            'id': int(er['id']),
                            'runId': er['run_id'],
                            'kind': er['kind'] or '',
                            'payload': payload,
                            'createdAt': to_iso(er['created_at']) or '',
                        })
                except sqlite3.Error:
                    pass
                try:
                    for rr in con.execute('select id, profile, status, started_at, ended_at, outcome, summary, error from task_runs where task_id=? order by started_at desc limit 50', (tid,)).fetchall():
                        result['runs'].append({
                            'id': int(rr['id']),
                            'profile': rr['profile'] or None,
                            'status': rr['status'] or '',
                            'startedAt': to_iso(rr['started_at']) or '',
                            'endedAt': to_iso(rr['ended_at']),
                            'outcome': rr['outcome'] or None,
                            'summary': rr['summary'] or None,
                            'error': rr['error'] or None,
                        })
                except sqlite3.Error:
                    pass
    finally:
        con.close()

print(json.dumps(result, ensure_ascii=False))
`;

interface RawTaskDetail {
  task: KanbanTask | null;
  comments: KanbanTaskDetail['comments'];
  events: KanbanTaskDetail['events'];
  runs: KanbanTaskDetail['runs'];
}

export async function getTaskDetail(boardSlug: string, taskId: string): Promise<KanbanTaskDetail | null> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const r = await runPython<RawTaskDetail>(TASK_DETAIL_SCRIPT, {
    timeoutMs: 6000,
    env: { ...process.env, BOARD: slug, TASK_ID: taskId },
  });
  if (!r.ok) throw new Error(`getTaskDetail failed: ${r.error}`);
  if (!r.value.task) return null;
  return {
    ...r.value.task,
    comments: r.value.comments || [],
    events: r.value.events || [],
    runs: r.value.runs || [],
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────
// All writes go through the `hermes kanban` CLI so the dispatcher's claim
// locks, notify subs and event stream stay consistent. We never construct
// shell commands by string concatenation — execFile arg arrays are safe.

interface CliArgs {
  args: string[];
  /** Input JSON to pass via stdin if the subcommand supports it. */
  stdin?: string;
}

async function runKanbanCli({ args, stdin }: CliArgs): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = ['kanban', ...args];
  try {
    const { stdout, stderr } = await execFileAsync('hermes', fullArgs, {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      input: stdin,
    } as Parameters<typeof execFileAsync>[2] & { input?: string });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const detail = (e.stderr || e.stdout || e.message || 'kanban_cli_failed').trim().slice(0, 480);
    throw new Error(detail || 'kanban_cli_failed');
  }
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  /** Maps directly to the CLI's `--workspace` arg. Accepts the same shape:
   *  `scratch`, `worktree`, or `dir:/abs/path`. */
  workspaceKind?: 'scratch' | 'worktree' | 'session';
  workspacePath?: string;
  tenant?: string;
  parents?: string[];
  skills?: string[];
}

export async function createTask(boardSlug: string, input: CreateTaskInput): Promise<{ id: string }> {
  const slug = safeBoard(boardSlug);
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title_required');
  if (title.length > 200) throw new Error('title_too_long');

  // Title is positional in the CLI; place it last after all flags.
  const args = ['--board', slug, 'create', '--json'];
  if (input.body) args.push('--body', String(input.body).slice(0, 8000));
  if (input.assignee) {
    const a = String(input.assignee).trim();
    if (a) args.push('--assignee', a);
  }
  if (typeof input.priority === 'number' && Number.isFinite(input.priority)) {
    const p = Math.max(-100, Math.min(100, Math.round(input.priority)));
    if (p) args.push('--priority', String(p));
  }
  // `--workspace` takes a single arg: `scratch | worktree | dir:<path>`.
  // We collapse the deck-side {kind, path} pair into that grammar.
  if (input.workspaceKind === 'scratch' || !input.workspaceKind) {
    // default — omit
  } else if (input.workspaceKind === 'worktree') {
    args.push('--workspace', 'worktree');
  } else if (input.workspaceKind === 'session') {
    // Hermes itself doesn't have a session workspace kind in the CLI; the
    // closest equivalent is dir:<path>. Expect callers to supply a path; if
    // they didn't, fall back to scratch (no --workspace flag).
    if (input.workspacePath) args.push('--workspace', `dir:${input.workspacePath.slice(0, 1024)}`);
  }
  if (input.tenant) args.push('--tenant', String(input.tenant).slice(0, 64));
  for (const parent of input.parents || []) {
    if (TASK_ID_RE.test(parent)) args.push('--parent', parent);
  }
  for (const skill of input.skills || []) {
    if (typeof skill === 'string' && skill.trim()) args.push('--skill', skill.trim().slice(0, 96));
  }
  // Title goes last (positional).
  args.push(title);

  const { stdout } = await runKanbanCli({ args });
  // CLI prints `{"id": "...", ...}` on --json.
  try {
    const parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || '{}');
    const id = parsed?.id || parsed?.task?.id;
    if (id) return { id: String(id) };
  } catch {}
  // Deliberately no loose-token fallback: a regex scan of human-readable
  // stdout reliably matched words like "Created" instead of the real id, and
  // a wrong id silently breaks every later action on the task. Fail cleanly.
  throw new Error('create_failed_no_id');
}

export type TaskAction = 'block' | 'unblock' | 'complete' | 'archive' | 'reclaim';

export async function applyTaskAction(boardSlug: string, taskId: string, action: TaskAction, opts?: { reason?: string; summary?: string }): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  // CLI flag layout per `hermes kanban <action> --help`:
  //   block  <task_id> [reason ...]            — reason is positional varargs
  //   unblock <task_id>                        — no extra args
  //   complete <task_id> [--summary SUMMARY]
  //   archive <task_id>                        — no extra args
  //   reclaim <task_id> [--reason REASON]
  const args = ['--board', slug, action, taskId];
  if (action === 'block' && opts?.reason) {
    args.push(String(opts.reason).slice(0, 480));
  } else if (action === 'reclaim' && opts?.reason) {
    args.push('--reason', String(opts.reason).slice(0, 480));
  } else if (action === 'complete' && opts?.summary) {
    args.push('--summary', String(opts.summary).slice(0, 480));
  }
  await runKanbanCli({ args });
}

export async function assignTask(boardSlug: string, taskId: string, profile: string | null): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  // CLI: `assign <task_id> <profile>` — pass literal "none" to clear.
  const profileArg = profile && profile !== '__unassign__' ? profile : 'none';
  if (profile && profile !== '__unassign__' && !/^[\w.-]{1,64}$/.test(profile)) {
    throw new Error('invalid_profile');
  }
  await runKanbanCli({ args: ['--board', slug, 'assign', taskId, profileArg] });
}

export async function commentTask(boardSlug: string, taskId: string, body: string, author?: string): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('comment_body_required');
  // CLI: `comment <task_id> <text> [--author AUTHOR]` — text is positional.
  const args = ['--board', slug, 'comment', taskId];
  if (author) {
    const a = String(author).trim().slice(0, 32);
    if (a) args.push('--author', a);
  }
  args.push(trimmed.slice(0, 4000));
  await runKanbanCli({ args });
}

export async function setActiveBoard(boardSlug: string): Promise<void> {
  const slug = safeBoard(boardSlug);
  // `boards switch <slug>` (alias: `use`).
  await runKanbanCli({ args: ['boards', 'switch', slug] });
}

// ── Batch 1: log / link / unlink (and runs already returned in detail) ─────

export async function getTaskLog(boardSlug: string, taskId: string, tail?: number): Promise<{ log: string; truncated: boolean }> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const args = ['--board', slug, 'log'];
  if (typeof tail === 'number' && Number.isFinite(tail) && tail > 0) {
    args.push('--tail', String(Math.min(Math.floor(tail), 4_000_000)));
  }
  args.push(taskId);
  try {
    const { stdout, stderr } = await runKanbanCli({ args });
    // CLI prints "<no log file>" to stderr when the worker hasn't started yet;
    // fall through and return empty.
    const text = stdout || stderr || '';
    return { log: text, truncated: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no log file|not.*found/i.test(msg)) return { log: '', truncated: false };
    throw err;
  }
}

export async function linkTasks(boardSlug: string, parentId: string, childId: string): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(parentId);
  assertTaskId(childId);
  if (parentId === childId) throw new Error('cannot_link_self');
  await runKanbanCli({ args: ['--board', slug, 'link', parentId, childId] });
}

export async function unlinkTasks(boardSlug: string, parentId: string, childId: string): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(parentId);
  assertTaskId(childId);
  await runKanbanCli({ args: ['--board', slug, 'unlink', parentId, childId] });
}

// ── Batch 2: diagnostics + watch (SSE) ─────────────────────────────────────

interface RawDiagnostic {
  task_id?: string;
  taskId?: string;
  severity?: string;
  kind?: string;
  message?: string;
  detail?: string;
  ts?: number | string;
  created_at?: number | string;
}

const VALID_SEVERITIES = new Set(['warning', 'error', 'critical']);

export async function getDiagnostics(
  boardSlug: string,
  opts?: { severity?: string; taskId?: string },
): Promise<KanbanDiagnostic[]> {
  const slug = safeBoard(boardSlug);
  const args = ['--board', slug, 'diagnostics', '--json'];
  if (opts?.severity && VALID_SEVERITIES.has(opts.severity)) {
    args.push('--severity', opts.severity);
  }
  if (opts?.taskId) {
    assertTaskId(opts.taskId);
    args.push('--task', opts.taskId);
  }
  try {
    const { stdout } = await runKanbanCli({ args });
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch { return []; }
    const list: RawDiagnostic[] = Array.isArray(parsed)
      ? (parsed as RawDiagnostic[])
      : Array.isArray((parsed as { diagnostics?: RawDiagnostic[] })?.diagnostics)
        ? ((parsed as { diagnostics: RawDiagnostic[] }).diagnostics)
        : [];
    return list.map((d) => ({
      taskId: String(d.taskId ?? d.task_id ?? '') || undefined,
      severity: (d.severity as KanbanDiagnostic['severity']) || 'warning',
      kind: String(d.kind || ''),
      message: String(d.message || d.detail || ''),
      createdAt: isoOrUndefined(d.ts ?? d.created_at),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't crash the UI if diagnostics-as-JSON isn't available on this build.
    if (/unrecognized arguments|invalid choice/i.test(msg)) return [];
    throw err;
  }
}

/** Long-running subprocess that polls `task_events.max(id)` and writes one
 *  JSON line per event-batch. The SSE route forwards each line as an SSE
 *  message. Caller is responsible for killing the process on disconnect.
 *
 *  We use a fresh sqlite connection per poll because `immutable=1` (the only
 *  flag that opens kanban.db reliably under concurrent writers) forbids
 *  observing changes within a single connection. */
const WATCH_EVENTS_SCRIPT = String.raw`
import sqlite3, time, sys, json, os, pathlib
home = pathlib.Path.home() / '.hermes'
slug = os.environ.get('BOARD','default')
if slug == 'default':
    db = home / 'kanban.db'
else:
    db = home / 'kanban' / 'boards' / slug / 'kanban.db'
last_id = int(os.environ.get('LAST_ID', '0'))
interval = float(os.environ.get('INTERVAL', '1.0'))

# First emit current cursor so the client can sync without an initial wait.
try:
    if db.exists():
        con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
        try:
            row = con.execute('select coalesce(max(id), 0) from task_events').fetchone()
            cur = int(row[0]) if row else 0
            print(json.dumps({'type': 'sync', 'lastId': cur}), flush=True)
            if last_id == 0:
                last_id = cur  # don't replay history on first connect
        finally:
            con.close()
    else:
        print(json.dumps({'type': 'sync', 'lastId': 0}), flush=True)
except Exception as e:
    print(json.dumps({'type': 'error', 'detail': str(e)[:200]}), flush=True)

while True:
    try:
        if db.exists():
            con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
            try:
                rows = con.execute(
                    'select id, task_id, kind, run_id, created_at from task_events where id > ? order by id asc limit 100',
                    (last_id,),
                ).fetchall()
                if rows:
                    for r in rows:
                        last_id = max(last_id, int(r[0]))
                        print(json.dumps({
                            'type': 'event',
                            'id': int(r[0]),
                            'taskId': r[1],
                            'kind': r[2] or '',
                            'runId': r[3],
                            'createdAt': r[4],
                        }), flush=True)
            finally:
                con.close()
        time.sleep(interval)
    except (KeyboardInterrupt, BrokenPipeError, SystemExit):
        break
    except sqlite3.Error:
        time.sleep(interval * 2)
`;

export interface WatchHandle {
  stream: ReadableStream<Uint8Array>;
  close: () => void;
}

export function watchBoardEvents(
  boardSlug: string,
  opts?: { lastId?: number; intervalSec?: number; signal?: AbortSignal },
): WatchHandle {
  const slug = safeBoard(boardSlug);
  const lastId = Math.max(0, Math.floor(opts?.lastId || 0));
  const interval = Math.max(0.5, Math.min(opts?.intervalSec || 1, 5));

  const child = spawn(process.execPath ? 'python3' : 'python3', ['-u', '-c', WATCH_EVENTS_SCRIPT], {
    env: { ...process.env, BOARD: slug, LAST_ID: String(lastId), INTERVAL: String(interval) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500).unref();
  };

  if (opts?.signal) {
    if (opts.signal.aborted) close();
    else opts.signal.addEventListener('abort', close, { once: true });
  }
  child.on('exit', () => { closed = true; });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          // Forward as a single SSE `data: …` message.
          try { controller.enqueue(enc.encode(`data: ${line}\n\n`)); } catch {}
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', () => {/* swallow noise */});
      child.on('exit', (code) => {
        try {
          controller.enqueue(enc.encode(`event: end\ndata: ${JSON.stringify({ code })}\n\n`));
          controller.close();
        } catch {}
      });
      child.on('error', (err) => {
        try {
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ detail: String(err.message || err).slice(0, 200) })}\n\n`));
        } catch {}
      });
    },
    cancel() { close(); },
  });

  return { stream, close };
}

// ── Batch 3: stats / assignees / context / edit ────────────────────────────

interface RawStats {
  by_status?: Record<string, number>;
  byStatus?: Record<string, number>;
  by_assignee?: Record<string, number>;
  byAssignee?: Record<string, number>;
  oldest_ready_age_sec?: number;
  oldestReadyAgeSec?: number;
  oldest_ready_age?: number;
  total?: number;
}

export async function getStats(boardSlug: string): Promise<KanbanStats> {
  const slug = safeBoard(boardSlug);
  const { stdout } = await runKanbanCli({ args: ['--board', slug, 'stats', '--json'] });
  let parsed: RawStats = {};
  try { parsed = JSON.parse(stdout.trim() || '{}') as RawStats; } catch {}
  const byStatus = parsed.by_status || parsed.byStatus || {};
  const byAssignee = parsed.by_assignee || parsed.byAssignee || {};
  const oldest = parsed.oldest_ready_age_sec ?? parsed.oldestReadyAgeSec ?? parsed.oldest_ready_age;
  const total = typeof parsed.total === 'number'
    ? parsed.total
    : Object.values(byStatus).reduce((a, b) => a + (Number(b) || 0), 0);
  return {
    total,
    byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, Number(v) || 0])),
    byAssignee: Object.fromEntries(Object.entries(byAssignee).map(([k, v]) => [k, Number(v) || 0])),
    oldestReadyAgeSec: typeof oldest === 'number' && Number.isFinite(oldest) ? oldest : undefined,
  };
}

interface RawAssignee {
  profile?: string;
  name?: string;
  ready?: number;
  running?: number;
  blocked?: number;
  done?: number;
  total?: number;
  active?: boolean;
  known?: boolean;
}

export async function getAssignees(boardSlug: string): Promise<KanbanAssignee[]> {
  const slug = safeBoard(boardSlug);
  const { stdout } = await runKanbanCli({ args: ['--board', slug, 'assignees', '--json'] });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  const list: RawAssignee[] = Array.isArray(parsed)
    ? (parsed as RawAssignee[])
    : Array.isArray((parsed as { assignees?: RawAssignee[] })?.assignees)
      ? ((parsed as { assignees: RawAssignee[] }).assignees)
      : [];
  return list.map((row) => ({
    profile: String(row.profile ?? row.name ?? ''),
    counts: {
      ready: Number(row.ready) || 0,
      running: Number(row.running) || 0,
      blocked: Number(row.blocked) || 0,
      done: Number(row.done) || 0,
      total: Number(row.total) || 0,
    },
    known: !!row.known,
  })).filter((a) => a.profile);
}

export async function getTaskContext(boardSlug: string, taskId: string): Promise<{ context: string }> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const { stdout } = await runKanbanCli({ args: ['--board', slug, 'context', taskId] });
  return { context: stdout || '' };
}

export interface EditTaskInput {
  result: string;
  summary?: string;
  /** Free-form JSON dict; we pass through verbatim after stringifying. */
  metadata?: unknown;
}

export async function editTask(boardSlug: string, taskId: string, input: EditTaskInput): Promise<void> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const result = String(input.result || '').trim();
  if (!result) throw new Error('result_required');
  const args = ['--board', slug, 'edit', '--result', result.slice(0, 8000)];
  if (input.summary) {
    args.push('--summary', String(input.summary).slice(0, 4000));
  }
  if (input.metadata !== undefined && input.metadata !== null) {
    let md: string;
    try { md = JSON.stringify(input.metadata); }
    catch { throw new Error('invalid_metadata'); }
    if (md.length > 16_000) throw new Error('metadata_too_large');
    args.push('--metadata', md);
  }
  args.push(taskId);
  await runKanbanCli({ args });
}

// ── Workspace markdown viewer/editor ───────────────────────────────────────
//
// alpha-labs / researcher workers commonly stash deep reports under the task's
// workspace path as `.md` files. We expose a constrained file browser anchored
// to that path so the user can read + lightly edit those reports from the deck.
//
// Constraints:
//   - Reads / writes are confined to the resolved workspace root (no traversal).
//   - Only `.md` extension is allowed.
//   - File size is capped at MD_MAX_BYTES.
//   - Writes refuse to create new files (avoid accidental directory pollution).
//   - Directory walk skips the usual heavy ignores (node_modules, .git, ...).

const MD_MAX_BYTES = 2_000_000;
const MD_MAX_FILES = 200;
const MD_SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__',
  'dist', 'build', '.next', '.turbo', '.cache', '.tox', '.idea', '.vscode',
]);

const WORKSPACE_PATH_SCRIPT = String.raw`
import json, os, pathlib, sqlite3
home = pathlib.Path.home() / '.hermes'
slug = os.environ.get('BOARD','default')
tid = os.environ.get('TASK_ID','')
db = home / 'kanban.db' if slug == 'default' else home / 'kanban' / 'boards' / slug / 'kanban.db'
out = {'workspaceKind': None, 'workspacePath': None}
if tid and db.exists():
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
        try:
            r = con.execute('select workspace_kind, workspace_path from tasks where id=?', (tid,)).fetchone()
            if r:
                out['workspaceKind'] = r[0]
                out['workspacePath'] = r[1]
        finally:
            con.close()
    except sqlite3.Error:
        pass
print(json.dumps(out, ensure_ascii=False))
`;

async function getTaskWorkspace(boardSlug: string, taskId: string): Promise<{ workspaceKind: string | null; workspacePath: string | null }> {
  const slug = safeBoard(boardSlug);
  assertTaskId(taskId);
  const r = await runPython<{ workspaceKind: string | null; workspacePath: string | null }>(WORKSPACE_PATH_SCRIPT, {
    timeoutMs: 4000,
    env: { ...process.env, BOARD: slug, TASK_ID: taskId },
  });
  if (!r.ok) throw new Error(`getTaskWorkspace failed: ${r.error}`);
  return r.value || { workspaceKind: null, workspacePath: null };
}

const ALPHA_LABS_WORKSPACE_ROOT = '/Users/fanxuxin/Hermes_Sync/AlphaLabs';

function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);
}

async function existingDirectory(absPath: string): Promise<string | null> {
  const abs = path.resolve(absPath);
  try {
    const lst = await fs.lstat(abs);
    // Do not anchor the browser on a symlink path; all later boundary checks
    // compare real paths rooted at the resolved workspace directory.
    if (lst.isSymbolicLink()) return null;
    const st = await fs.stat(abs);
    if (!st.isDirectory()) return null;
    return await fs.realpath(abs);
  } catch {
    return null;
  }
}

async function resolveWorkspaceRoot(boardSlug: string, taskId: string): Promise<string | null> {
  const ws = await getTaskWorkspace(boardSlug, taskId);
  const wp = (ws.workspacePath || '').trim();
  if (!wp) return null;
  // path.resolve normalizes and gives us an absolute path (relative inputs
  // resolve against process cwd, but workspace_path is always absolute in
  // practice — Hermes stores absolute paths only).
  return existingDirectory(wp);
}

async function resolveMarkdownRoots(boardSlug: string, taskId: string): Promise<string[]> {
  const roots: string[] = [];
  const taskRoot = await resolveWorkspaceRoot(boardSlug, taskId);
  if (taskRoot) roots.push(taskRoot);

  // Alpha Labs approval cards often point at canonical reports under
  // /Users/fanxuxin/Hermes_Sync/AlphaLabs even when the task itself has an
  // older/missing scratch workspace. Keep the file API constrained, but include
  // that canonical root as an additional allowed read/edit anchor for the
  // alpha-labs board.
  if (safeBoard(boardSlug) === 'alpha-labs') {
    const alphaRoot = await existingDirectory(ALPHA_LABS_WORKSPACE_ROOT);
    if (alphaRoot && !roots.includes(alphaRoot)) roots.push(alphaRoot);
  }
  return roots;
}

async function safeJoin(root: string, relPath: string): Promise<string> {
  // Reject NUL and backslashes outright — we only run on posix; backslash in a
  // user-supplied path is almost certainly an attempt to confuse path.resolve
  // on Windows.
  if (relPath.includes('\0') || relPath.includes('\\')) throw new Error('invalid_path');
  const rootAbs = await fs.realpath(path.resolve(root));
  const candidate = path.isAbsolute(relPath)
    ? path.resolve(relPath)
    : path.resolve(rootAbs, relPath.replace(/^[/]+/, ''));
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + path.sep)) {
    throw new Error('path_outside_workspace');
  }
  return candidate;
}

async function resolveMarkdownTarget(boardSlug: string, taskId: string, relPath: string): Promise<{ root: string; abs: string }> {
  if (!relPath.trim()) throw new Error('invalid_path');
  const roots = await resolveMarkdownRoots(boardSlug, taskId);
  if (!roots.length) throw new Error('no_workspace');

  let firstPathError: Error | null = null;
  for (const root of roots) {
    try {
      const abs = await safeJoin(root, relPath);
      return { root, abs };
    } catch (err) {
      firstPathError ||= err instanceof Error ? err : new Error(String(err));
    }
  }
  throw firstPathError || new Error('path_outside_workspace');
}

export async function listMarkdownFiles(boardSlug: string, taskId: string): Promise<KanbanMarkdownListResult> {
  const roots = await resolveMarkdownRoots(boardSlug, taskId);
  const root = roots[0] || null;
  if (!root) return { root: null, entries: [] };
  const rootReal = await fs.realpath(root);
  const out: KanbanMarkdownListResult['entries'] = [];
  const queue: string[] = [rootReal];
  // BFS so the top-level files surface before nested ones in the unsorted
  // intermediate buffer (we still re-sort by mtime at the end).
  while (queue.length > 0 && out.length < MD_MAX_FILES) {
    const dir = queue.shift()!;
    let dirents: import('node:fs').Dirent[];
    try {
      if (!isWithinRoot(rootReal, await fs.realpath(dir))) continue;
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of dirents) {
      if (out.length >= MD_MAX_FILES) break;
      const name = ent.name;
      // Skip dot-files / dot-dirs unconditionally — they're rarely the user's
      // deep reports and a dot-dir like .obsidian/ blows the file budget.
      if (name.startsWith('.') || ent.isSymbolicLink()) continue;
      const abs = path.join(dir, name);
      if (ent.isDirectory()) {
        if (MD_SKIP_DIRS.has(name)) continue;
        try {
          const dirReal = await fs.realpath(abs);
          if (isWithinRoot(rootReal, dirReal)) queue.push(dirReal);
        } catch {/* ignore unreadable */}
      } else if (ent.isFile() && name.toLowerCase().endsWith('.md')) {
        try {
          const lst = await fs.lstat(abs);
          if (lst.isSymbolicLink() || !lst.isFile()) continue;
          const real = await fs.realpath(abs);
          if (!isWithinRoot(rootReal, real)) continue;
          const st = await fs.stat(real);
          out.push({
            path: path.relative(rootReal, real),
            size: st.size,
            mtime: Math.round(st.mtimeMs / 1000),
          });
        } catch {/* ignore unreadable */}
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return { root: rootReal, entries: out };
}

export async function readMarkdownFile(boardSlug: string, taskId: string, relPath: string): Promise<KanbanMarkdownFile> {
  const { root, abs } = await resolveMarkdownTarget(boardSlug, taskId, relPath);
  if (!abs.toLowerCase().endsWith('.md')) throw new Error('not_markdown');
  const rootReal = await fs.realpath(root);
  const lst = await fs.lstat(abs);
  if (lst.isSymbolicLink()) throw new Error('path_outside_workspace');
  const real = await fs.realpath(abs);
  if (!isWithinRoot(rootReal, real)) throw new Error('path_outside_workspace');
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error('not_a_file');
  if (st.size > MD_MAX_BYTES) throw new Error('file_too_large');
  const content = await fs.readFile(real, 'utf8');
  return {
    path: path.relative(rootReal, real),
    size: st.size,
    mtime: Math.round(st.mtimeMs / 1000),
    content,
  };
}

export async function writeMarkdownFile(boardSlug: string, taskId: string, relPath: string, content: string, mtime?: number): Promise<{ ok: true; path: string; size: number; mtime: number }> {
  const { root, abs } = await resolveMarkdownTarget(boardSlug, taskId, relPath);
  if (!abs.toLowerCase().endsWith('.md')) throw new Error('not_markdown');
  if (Buffer.byteLength(content, 'utf8') > MD_MAX_BYTES) throw new Error('file_too_large');
  // Existing-file guard: refuse to materialize new MD docs from the UI. The
  // user's reports are produced by workers; the editor is for tweaks, not
  // ad-hoc creation. This also keeps the path validator simple — we never
  // need to mkdir intermediate directories.
  let preStat: import('node:fs').Stats;
  const rootReal = await fs.realpath(root);
  let real = '';
  try {
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) throw new Error('path_outside_workspace');
    real = await fs.realpath(abs);
    if (!isWithinRoot(rootReal, real)) throw new Error('path_outside_workspace');
    preStat = await fs.stat(real);
  }
  catch (err) {
    if (err instanceof Error && /path_outside_workspace/.test(err.message)) throw err;
    throw new Error('file_not_found');
  }
  if (!preStat.isFile()) throw new Error('not_a_file');
  // Optimistic concurrency: when the caller passes the mtime it last read,
  // reject if the file changed on disk since then — a kanban worker may have
  // rewritten the report under the editor, and an unconditional write would
  // silently clobber that. mtime is epoch seconds, matching readMarkdownFile.
  if (typeof mtime === 'number' && Number.isFinite(mtime)) {
    const current = Math.round(preStat.mtimeMs / 1000);
    if (current !== mtime) throw new Error('mtime_conflict');
  }
  const handle = await fs.open(real, fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
  const st = await fs.stat(real);
  return {
    ok: true,
    path: path.relative(rootReal, real),
    size: st.size,
    mtime: Math.round(st.mtimeMs / 1000),
  };
}
