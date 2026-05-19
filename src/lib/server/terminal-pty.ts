// Live tmux-backed terminal manager. Each "session" here owns one node-pty
// child running `tmux new-session -A -s <name>`, so reconnects re-attach to
// the same tmux session and survive page reloads. Output is fanned out to
// SSE subscribers and a small ring buffer is replayed on reconnect.
//
// Hardening assumptions: this is a self-hosted local dev tool, but we still
// validate IDs to keep them out of shell argv, cap subscriber counts, and
// require an explicit env opt-in (HERMESDECK_LIVE_TERMINAL=1) before spawning
// real ptys. tmux is invoked with execFile (shell:false) for control commands.
//
// Because the spawned shell can read the deck's environment, we strip secrets
// (HERMES_API_KEY, HERMESDECK_SESSION_SECRET, etc.) before merging process.env
// into the child env. Operators who need additional env vars must set
// HERMESDECK_TERMINAL_ENV_PASSTHROUGH explicitly.

import { execFile, spawn as cpSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export type LiveTerminalSession = {
  id: string;
  tmuxName: string;
  label: string;
  createdAt: number;
  cols: number;
  rows: number;
  alive: boolean;
};

type Subscriber = {
  id: string;
  send: (event: 'data' | 'meta' | 'exit', payload: unknown) => void;
  close: () => void;
};

type IPty = {
  pid: number;
  cols: number;
  rows: number;
  onData: (cb: (data: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
  kill: (signal?: string) => void;
};

type Entry = {
  meta: LiveTerminalSession;
  pty: IPty;
  buffer: string[];      // ring buffer of recent chunks
  bufferBytes: number;   // running total
  subscribers: Map<string, Subscriber>;
  lastActivity: number;
  lastSubscriberLeftAt: number; // 0 when at least one subscriber is attached
};

const TMUX = process.env.HERMESDECK_TMUX_BIN || 'tmux';
const SOCKET_NAME = 'hermesdeck';
const MAX_SESSIONS = 8;
const MAX_SUBSCRIBERS_PER_SESSION = 8;
const BUFFER_LIMIT_BYTES = 256 * 1024;
const ABANDONED_REAP_MS = 10 * 60 * 1000; // kill live PTYs nobody has watched in 10 minutes

const sessions = new Map<string, Entry>();
let ptyMod: typeof import('node-pty') | null = null;

function loadPty(): typeof import('node-pty') {
  if (ptyMod) return ptyMod;
  // Defer the require so build-time bundling never tries to pull the native
  // addon into the client/edge build. createRequire works in both CJS and
  // ESM module contexts that Next's server runtime uses. The turbopackIgnore
  // hint stops Turbopack from tracing the native binary into the NFT bundle
  // (it's resolved at runtime against the operator's installed node-pty).
  const req = createRequire(import.meta.url);
  ptyMod = req(/* turbopackIgnore: true */ 'node-pty') as typeof import('node-pty');
  return ptyMod;
}

export function liveTerminalEnabled(): boolean {
  return process.env.HERMESDECK_LIVE_TERMINAL === '1';
}

function ensureEnabled() {
  if (!liveTerminalEnabled()) {
    throw new Error('Live terminal is disabled. Set HERMESDECK_LIVE_TERMINAL=1 on the server to enable.');
  }
}

function validateId(input: unknown): string {
  const id = String(input || '');
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(id)) throw new Error('Invalid terminal id');
  return id;
}

function validateLabel(input: unknown): string {
  const s = String(input || '').trim().slice(0, 64);
  if (!s) return 'shell';
  // Strict allowlist: alnum, space, dash, underscore, dot. We previously
  // allowed `:` `+` `/` but those overlap with tmux target syntax (`session:0`),
  // and there's no real reason a window name needs them.
  if (!/^[A-Za-z0-9 _.\-]+$/.test(s)) throw new Error('Invalid label');
  return s;
}

function strictWindowIndex(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error('Invalid windowIndex (expected integer 0..99)');
  }
  return n;
}

function clampDim(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

// Env vars deliberately stripped from the spawned shell. They're sensitive and
// the user generally does not want them in scrollback or `env | grep`.
const ENV_DENY_LIST = new Set([
  'HERMES_API_KEY',
  'HERMESDECK_SESSION_SECRET',
  'HERMES_API_BASE',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
]);

function buildChildEnv(extras: Record<string, string>): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue;
    if (ENV_DENY_LIST.has(k)) continue;
    // Drop anything that looks token-shaped even if not in the explicit list.
    // Heuristic only — we keep PATH, HOME, etc., which are short and structural.
    if (/(?:_KEY|_SECRET|_TOKEN|_PASSWORD)$/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, ...extras } as NodeJS.ProcessEnv;
}

async function tmux(args: string[], opts: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = ['-L', SOCKET_NAME, '-f', tmuxConfPath(), ...args];
  return execFileAsync(TMUX, fullArgs, { timeout: opts.timeout ?? 4000, maxBuffer: 256 * 1024, shell: false });
}

let cachedConfPath: string | null = null;
// Write a tiny tmux.conf the first time we need it. Disabling the status
// bar gives the embedded shell a full row back; mouse + utf8 keep the user's
// p10k-style prompts and selection working.
function tmuxConfPath(): string {
  if (cachedConfPath) return cachedConfPath;
  const dir = join(os.tmpdir(), 'hermesdeck-tmux');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const f = join(dir, 'tmux.conf');
  writeFileSync(f, [
    'set -g status off',
    'set -g mouse on',
    'set -g default-terminal "xterm-256color"',
    'set -ga terminal-overrides ",xterm-256color:Tc"',
    'set -g escape-time 10',
    'set -g focus-events on',
    'set -g history-limit 10000',
    'setw -g aggressive-resize on',
    '',
  ].join('\n'));
  cachedConfPath = f;
  return f;
}

function appendToBuffer(entry: Entry, data: string) {
  entry.buffer.push(data);
  entry.bufferBytes += data.length;
  while (entry.bufferBytes > BUFFER_LIMIT_BYTES && entry.buffer.length > 1) {
    const drop = entry.buffer.shift()!;
    entry.bufferBytes -= drop.length;
  }
  entry.lastActivity = Date.now();
}

function broadcast(entry: Entry, event: 'data' | 'meta' | 'exit', payload: unknown) {
  for (const sub of entry.subscribers.values()) {
    try { sub.send(event, payload); } catch { /* drop broken subs silently */ }
  }
}

export async function listSessions(): Promise<LiveTerminalSession[]> {
  if (!liveTerminalEnabled()) return [];
  // Trust local state; tmux ls is informational and may fail when no server is running.
  return Array.from(sessions.values()).map((e) => ({ ...e.meta }));
}

export async function createSession(input: { label?: string; cols?: number; rows?: number } = {}): Promise<LiveTerminalSession> {
  ensureEnabled();
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Live terminal session limit reached (${MAX_SESSIONS})`);
  }
  // First session of this server boot? Wipe any leftover tmux server on our
  // private socket so the new server reads our `-f` config (status off, mouse,
  // truecolor, etc.). Subsequent sessions reuse the same server, which is
  // fine — it's already configured.
  if (sessions.size === 0) {
    try { await execFileAsync(TMUX, ['-L', SOCKET_NAME, 'kill-server'], { timeout: 2000, shell: false }); } catch {}
  }
  const label = validateLabel(input.label || 'shell');
  const cols = clampDim(input.cols, 20, 400, 100);
  const rows = clampDim(input.rows, 5, 200, 30);
  const id = randomUUID().slice(0, 12);
  const tmuxName = `hd-${id}`;

  const pty = loadPty();
  // Pass `-f` to point tmux at our own minimal config: hides the tmux status
  // bar (we have our own window strip), keeps mouse + 256color on. Also
  // sets `default-terminal` to xterm-256color for parity with the pty.
  // -A attaches if a session with that name already exists, otherwise creates.
  const child = pty.spawn(TMUX, [
    '-L', SOCKET_NAME,
    '-f', tmuxConfPath(),
    'new-session', '-A', '-s', tmuxName,
    '-x', String(cols), '-y', String(rows),
  ], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || os.homedir() || '/',
    env: buildChildEnv({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Force a UTF-8 locale so the spawned shell handles multi-byte input
      // (CJK, emoji, accented Latin). If the dev server's parent has nothing
      // set — common when launched from a daemon, plain `node`, or a stripped
      // env — zsh falls back to C locale and silently drops non-ASCII bytes.
      // We respect existing values if the user really wants e.g. zh_CN.UTF-8.
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      LC_CTYPE: process.env.LC_CTYPE || process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      HERMESDECK_TMUX_SESSION: tmuxName,
    }),
  }) as unknown as IPty;

  const meta: LiveTerminalSession = {
    id,
    tmuxName,
    label,
    createdAt: Date.now(),
    cols,
    rows,
    alive: true,
  };

  const entry: Entry = {
    meta,
    pty: child,
    buffer: [],
    bufferBytes: 0,
    subscribers: new Map(),
    lastActivity: Date.now(),
    lastSubscriberLeftAt: Date.now(), // marked "abandoned" until first subscriber attaches
  };

  child.onData((data) => {
    appendToBuffer(entry, data);
    broadcast(entry, 'data', data);
  });
  child.onExit((e) => {
    entry.meta.alive = false;
    broadcast(entry, 'exit', { exitCode: e.exitCode, signal: e.signal ?? null });
    for (const sub of entry.subscribers.values()) { try { sub.close(); } catch {} }
    entry.subscribers.clear();
    sessions.delete(id);
  });

  sessions.set(id, entry);
  return { ...meta };
}

const AUDIT_INPUT_THRESHOLD = 256;
let auditWarnedDisabled = false;

function auditPtyInput(id: string, data: string) {
  // Lightweight audit log: every input chunk over the threshold gets a redacted
  // line so an operator forensicating a stolen-cookie incident has a record.
  // We never log full PII / secrets; only length + first 32 sanitized bytes.
  if (data.length < AUDIT_INPUT_THRESHOLD) return;
  try {
    const head = data.slice(0, 32).replace(/[^\x20-\x7e]/g, '·');
    // eslint-disable-next-line no-console
    console.log(`[pty-audit] session=${id} bytes=${data.length} head=${JSON.stringify(head)}`);
  } catch {
    if (!auditWarnedDisabled) {
      auditWarnedDisabled = true;
      // eslint-disable-next-line no-console
      console.warn('[pty-audit] disabled (logger threw)');
    }
  }
}

export function writeSession(id: string, data: string) {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry || !entry.meta.alive) throw new Error('Session not found');
  if (typeof data !== 'string') throw new Error('Invalid data');
  if (data.length > 64 * 1024) throw new Error('Input chunk too large');
  auditPtyInput(entry.meta.id, data);
  entry.pty.write(data);
}

export function resizeSession(id: string, cols: number, rows: number) {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry || !entry.meta.alive) throw new Error('Session not found');
  const c = clampDim(cols, 20, 400, entry.meta.cols);
  const r = clampDim(rows, 5, 200, entry.meta.rows);
  entry.meta.cols = c;
  entry.meta.rows = r;
  entry.pty.resize(c, r);
  // Inform tmux too — useful when more than one client has different sizes.
  tmux(['refresh-client', '-t', entry.meta.tmuxName, '-S']).catch(() => {});
  broadcast(entry, 'meta', { cols: c, rows: r });
}

export async function killSession(id: string) {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry) return;
  // Ask tmux to tear down its session; the pty exits when tmux detaches.
  try { await tmux(['kill-session', '-t', entry.meta.tmuxName]); } catch {}
  try { entry.pty.kill(); } catch {}
}

export type Subscription = {
  replay: string[];
  cols: number;
  rows: number;
  unsubscribe: () => void;
};

export function subscribe(id: string, sub: Omit<Subscriber, 'id'>): Subscription {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry || !entry.meta.alive) throw new Error('Session not found');
  if (entry.subscribers.size >= MAX_SUBSCRIBERS_PER_SESSION) {
    throw new Error('Too many subscribers for this session');
  }
  const subId = randomUUID();
  entry.subscribers.set(subId, { id: subId, ...sub });
  entry.lastSubscriberLeftAt = 0;
  return {
    replay: [...entry.buffer],
    cols: entry.meta.cols,
    rows: entry.meta.rows,
    unsubscribe: () => {
      entry.subscribers.delete(subId);
      if (entry.subscribers.size === 0) entry.lastSubscriberLeftAt = Date.now();
    },
  };
}

export type TmuxWindow = { index: number; name: string; active: boolean };

export async function listWindows(id: string): Promise<TmuxWindow[]> {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry) throw new Error('Session not found');
  try {
    const { stdout } = await tmux([
      'list-windows', '-t', entry.meta.tmuxName,
      '-F', '#{window_index}\t#{window_name}\t#{?window_active,1,0}',
    ]);
    return stdout.split('\n').filter(Boolean).map((line) => {
      const [idxStr, name, activeStr] = line.split('\t');
      return { index: Number(idxStr), name: name || `win${idxStr}`, active: activeStr === '1' };
    });
  } catch {
    return [];
  }
}

const TMUX_ACTIONS = new Set([
  'new-window', 'kill-window', 'select-window', 'rename-window', 'split-pane', 'select-pane',
]);

export async function tmuxCommand(
  id: string,
  body: { action: 'new-window' | 'kill-window' | 'select-window' | 'rename-window' | 'split-pane' | 'select-pane'; windowIndex?: number; name?: string; direction?: 'h' | 'v'; paneTarget?: string },
): Promise<{ ok: true }> {
  ensureEnabled();
  const entry = sessions.get(validateId(id));
  if (!entry) throw new Error('Session not found');
  if (!body || typeof body.action !== 'string' || !TMUX_ACTIONS.has(body.action)) {
    throw new Error('Invalid tmux action');
  }
  const target = entry.meta.tmuxName;
  switch (body.action) {
    case 'new-window': {
      const args = ['new-window', '-t', target];
      if (body.name) { args.push('-n', validateLabel(body.name)); }
      await tmux(args);
      break;
    }
    case 'kill-window': {
      const idx = strictWindowIndex(body.windowIndex);
      await tmux(['kill-window', '-t', `${target}:${idx}`]);
      break;
    }
    case 'select-window': {
      const idx = strictWindowIndex(body.windowIndex);
      await tmux(['select-window', '-t', `${target}:${idx}`]);
      break;
    }
    case 'rename-window': {
      const idx = strictWindowIndex(body.windowIndex);
      await tmux(['rename-window', '-t', `${target}:${idx}`, validateLabel(body.name)]);
      break;
    }
    case 'split-pane': {
      const args = ['split-window', '-t', target, body.direction === 'h' ? '-h' : '-v'];
      await tmux(args);
      break;
    }
    case 'select-pane': {
      const dir = body.paneTarget;
      const args = ['select-pane', '-t', target];
      if (dir === 'U') args.push('-U');
      else if (dir === 'D') args.push('-D');
      else if (dir === 'L') args.push('-L');
      else if (dir === 'R') args.push('-R');
      await tmux(args);
      break;
    }
    default:
      throw new Error('Unknown tmux action');
  }
  return { ok: true };
}

// Garbage-collect both dead (exited) sessions and live-but-abandoned sessions
// (every browser tab disconnected without DELETE). Without the abandoned-reap,
// orphaned PTYs accumulate forever after MAX_SESSIONS is reached.
setInterval(() => {
  const now = Date.now();
  for (const entry of sessions.values()) {
    if (!entry.meta.alive && now - entry.lastActivity > 5 * 60 * 1000) {
      sessions.delete(entry.meta.id);
      continue;
    }
    if (
      entry.meta.alive &&
      entry.subscribers.size === 0 &&
      entry.lastSubscriberLeftAt > 0 &&
      now - entry.lastSubscriberLeftAt > ABANDONED_REAP_MS
    ) {
      try { entry.pty.kill(); } catch {}
      try { execFileAsync(TMUX, ['-L', SOCKET_NAME, 'kill-session', '-t', entry.meta.tmuxName], { timeout: 2000, shell: false }).catch(() => {}); } catch {}
      sessions.delete(entry.meta.id);
    }
  }
}, 60_000).unref?.();

// Best-effort cleanup on server shutdown. We use prependListener so we run
// before Next's own SIGTERM handler tears the runtime down.
function shutdown() {
  for (const entry of sessions.values()) {
    try { entry.pty.kill(); } catch {}
  }
  sessions.clear();
  try { cpSpawn(TMUX, ['-L', SOCKET_NAME, 'kill-server'], { stdio: 'ignore' }).unref(); } catch {}
}
process.prependListener('SIGINT', shutdown);
process.prependListener('SIGTERM', shutdown);
