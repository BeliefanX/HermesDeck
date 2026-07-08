'use client';

// xterm.js + tmux glue. We render a real terminal, stream pty output via SSE,
// post keystrokes/resize/tmux commands to /api/deck/term/*. The component
// stays self-contained — no global state, no zustand — so it can be dropped
// into any page tab without coupling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, RefreshCw, AlertTriangle, Square, SplitSquareHorizontal, SplitSquareVertical, Terminal as TermIcon, Loader2 } from 'lucide-react';
import { Btn, Tag } from '@/components/Brand';
import { deckApi } from '@/lib/api';
import type { LiveTerminalSession, LiveTerminalWindow } from '@/lib/types';

// xterm + addons — typings come from the packages. We import the CSS too,
// otherwise the canvas renders unstyled and the glyphs end up clipped.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
// Unicode 11 width tables — without this, CJK characters render single-width
// and overlap their neighbors instead of taking the two cells they need.
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

type Phase = 'idle' | 'loading' | 'ready' | 'disabled' | 'error';

// Module-level lock so a single user click never spawns two sessions, even
// across React StrictMode double-mounts, accidental double-taps, or fast
// duplicate dispatches from synthetic events. A normal in-component ref isn't
// enough because StrictMode can produce two separate component instances
// briefly during dev — each with its own ref — both reacting to the same DOM
// click. Module-level state survives both.
let createInFlight: Promise<LiveTerminalSession | null> | null = null;
let lastCreateAt = 0;

export function LiveTerminal() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [sessions, setSessions] = useState<LiveTerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [windows, setWindows] = useState<LiveTerminalWindow[]>([]);
  const [creating, setCreating] = useState(false);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostElRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const inputDataDisposeRef = useRef<(() => void) | null>(null);
  const inputResizeDisposeRef = useRef<(() => void) | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [termReady, setTermReady] = useState(0);

  // Callback ref initializes xterm only when the host node is actually
  // attached to the DOM, and tears down when it's removed. This is the only
  // pattern I've found that survives React 18 StrictMode's double-mount and
  // keeps the xterm canvas attached to the live host instead of an orphaned
  // first-render node.
  const setTermHost = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      // If we already mounted on this exact node, do nothing — StrictMode
      // can re-fire ref callbacks when nothing actually changed.
      if (hostElRef.current === node && termRef.current) return;
      // New host: dispose any prior term, then create on the new node.
      try { termRef.current?.dispose(); } catch {}
      const term = new Terminal({
        // xterm measures glyph width via canvas; CSS variables don't always
        // resolve in that path, so list real font names. Order: anything the
        // user explicitly set in their OS, then the macOS default mono, then
        // a Linux fallback chain.
        fontFamily: '"MesloLGS NF", "JetBrainsMono Nerd Font", "Fira Code", Menlo, Monaco, "DejaVu Sans Mono", "Liberation Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.15,
        letterSpacing: 0,
        cursorBlink: true,
        convertEol: false,
        allowProposedApi: true,
        scrollback: 10000,
        theme: terminalTheme(),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      const u11 = new Unicode11Addon();
      term.loadAddon(u11);
      // Activate the Unicode 11 width provider so wcwidth-style measurements
      // pick up CJK + emoji as 2-cell glyphs.
      try { term.unicode.activeVersion = '11'; } catch {}
      term.open(node);
      try { fit.fit(); } catch {}
      termRef.current = term;
      fitRef.current = fit;
      hostElRef.current = node;
      setTermReady((n) => n + 1);
    } else {
      // Host detached — dispose so we don't leak a hidden canvas.
      try { termRef.current?.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
      hostElRef.current = null;
    }
  }, []);

  // ---------- bootstrap ----------
  const refreshList = useCallback(async () => {
    try {
      const r = await deckApi.liveList();
      if (!r.enabled) {
        setPhase('disabled');
        setSessions([]);
        return;
      }
      setSessions(r.sessions);
      setPhase('ready');
      if (!activeId && r.sessions.length > 0) {
        setActiveId(r.sessions[0].id);
      }
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }, [activeId]);

  useEffect(() => {
    setPhase('loading');
    refreshList();
  }, [refreshList]);

  // ---------- ResizeObserver: keep xterm sized to its host ----------
  useEffect(() => {
    const host = hostElRef.current;
    const fit = fitRef.current;
    if (!host || !fit) return;
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(host);
    return () => ro.disconnect();
  }, [termReady]);

  // ---------- attach SSE + input handlers when activeId changes ----------
  useEffect(() => {
    const term = termRef.current;
    if (!term || !activeId) return;
    void termReady; // re-run when xterm is (re)created

    term.reset();
    term.focus();

    inputDataDisposeRef.current?.();
    inputResizeDisposeRef.current?.();

    // Replay-suppression flag: while we're writing the SSE backlog into xterm,
    // the parser may encounter the previous shell's terminal queries (DA1/DA2/
    // DSR/etc) and auto-generate replies. We don't want those replies typed
    // into the live shell — they show up as garbage like "1;2c0;276;0c". The
    // server emits a `replay-end` event after flushing the buffer; we flip
    // suppressing off then. Belt-and-suspenders 800ms timeout in case the
    // marker is dropped (older servers, network blip).
    let suppressing = true;
    const stopSuppress = () => { suppressing = false; };
    const suppressTimeout = setTimeout(stopSuppress, 800);

    const sub = term.onData((data) => {
      if (suppressing) return;
      const cleaned = stripEmulatorReplies(data);
      if (!cleaned) return;
      // Fire-and-forget; an occasional dropped chunk is fine (the user will
      // see the lack of echo and retype). We avoid awaiting so each keystroke
      // doesn't add round-trip latency to the next.
      deckApi.liveInput(activeId, cleaned).catch(() => {});
    });
    inputDataDisposeRef.current = () => sub.dispose();

    const pushResize = () => {
      const cols = term.cols, rows = term.rows;
      const prev = lastSizeRef.current;
      if (prev && prev.cols === cols && prev.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      deckApi.liveResize(activeId, cols, rows).catch(() => {});
    };
    const resizeSub = term.onResize(pushResize);
    inputResizeDisposeRef.current = () => resizeSub.dispose();
    // Send initial size after attach.
    queueMicrotask(pushResize);

    // Open SSE
    sseRef.current?.close();
    const es = new EventSource(`/api/deck/term/sessions/${encodeURIComponent(activeId)}/stream`);
    sseRef.current = es;
    es.addEventListener('ready', () => {
      try { fitRef.current?.fit(); } catch {}
      pushResize();
    });
    es.addEventListener('data', (ev: MessageEvent) => {
      try {
        const chunk = JSON.parse(ev.data);
        term.write(chunk);
      } catch {}
    });
    es.addEventListener('replay-end', () => {
      // Server finished flushing the backlog; xterm's parser has now
      // processed everything that could trigger an auto-reply. The replies
      // (if any) are queued onto term.onData, but they fire after this event
      // since both go through the same async event loop. queueMicrotask gives
      // them one more tick to drain, then we open the gate for real input.
      queueMicrotask(() => { clearTimeout(suppressTimeout); stopSuppress(); });
    });
    es.addEventListener('exit', () => {
      term.writeln('\r\n\x1b[2m[session ended]\x1b[0m');
      es.close();
      void refreshList();
      setActiveId((cur) => (cur === activeId ? null : cur));
    });
    es.addEventListener('error', (ev: MessageEvent) => {
      // The server emits an "error" SSE event when the session is gone.
      try {
        const data = ev.data ? JSON.parse(ev.data) : null;
        if (data?.error) term.writeln(`\r\n\x1b[31m[stream error] ${data.error}\x1b[0m`);
      } catch { /* native onerror — ignore */ }
    });
    es.onerror = () => {
      // Network blip; browser will auto-retry. Show a quiet hint once.
      // (We let xterm keep its current screen.)
    };

    void refreshWindows(activeId);

    return () => {
      clearTimeout(suppressTimeout);
      sub.dispose();
      resizeSub.dispose();
      es.close();
      sseRef.current = null;
    };
  }, [activeId, refreshList, termReady]);

  // ---------- session/window controls ----------
  async function createSession() {
    // Three-layer dedup:
    //   1. UI state (`creating`) — disables the button visually
    //   2. Module-level promise — joins concurrent calls (incl. StrictMode
    //      double-mounts and accidental double-clicks)
    //   3. 300ms cooldown — kills repeat synthetic events from touch + click
    if (creating) return;
    if (Date.now() - lastCreateAt < 300) return;
    if (createInFlight) { await createInFlight; return; }
    lastCreateAt = Date.now();
    setCreating(true);
    createInFlight = (async () => {
      try {
        try { fitRef.current?.fit(); } catch {}
        const cols = Math.max(40, termRef.current?.cols ?? 100);
        const rows = Math.max(10, termRef.current?.rows ?? 30);
        const { session } = await deckApi.liveCreate({ label: nextSessionLabel(sessions), cols, rows });
        setSessions((prev) => prev.some((s) => s.id === session.id) ? prev : [...prev, session]);
        setActiveId(session.id);
        return session;
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setCreating(false);
      }
    })();
    try { await createInFlight; } finally { createInFlight = null; }
  }

  async function killSession(id: string) {
    try {
      await deckApi.liveKill(id);
    } catch {}
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function refreshWindows(id: string) {
    try {
      const r = await deckApi.liveWindows(id);
      setWindows(r.windows);
    } catch {
      setWindows([]);
    }
  }

  async function tmux(body: Parameters<typeof deckApi.liveTmux>[1]) {
    if (!activeId) return;
    try { await deckApi.liveTmux(activeId, body); } catch {}
    void refreshWindows(activeId);
    termRef.current?.focus();
  }

  // ---------- render ----------
  if (phase === 'loading') {
    return (
      <Centered>
        <Loader2 size={18} style={{ animation: 'rot 1s linear infinite' }} />
        <span style={{ marginLeft: 8 }}>Loading live terminal…</span>
      </Centered>
    );
  }

  if (phase === 'disabled') {
    return (
      <Centered>
        <div style={{ maxWidth: 540, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={20} style={{ color: 'var(--yellow)' }} />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--strong-text)' }}>Live terminal is disabled</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
            For safety, the live tmux-backed shell only spawns when the server starts with{' '}
            <code style={mono}>HERMESDECK_LIVE_TERMINAL=1</code>. Restart the dev server with that env set:
            <pre style={{ margin: '8px 0 0', padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5, textAlign: 'left' }}>HERMESDECK_LIVE_TERMINAL=1 npm run dev</pre>
          </div>
        </div>
      </Centered>
    );
  }

  if (phase === 'error') {
    return (
      <Centered>
        <AlertTriangle size={18} style={{ color: 'var(--red)' }} />
        <span style={{ marginLeft: 8 }}>{errorMsg || 'Live terminal unavailable.'}</span>
      </Centered>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* Session strip */}
      <div style={stripStyle}>
        <TermIcon size={13} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 10, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>tmux</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                style={tabStyle(active)}
                title={`tmux: ${s.tmuxName} · ${s.cols}×${s.rows}`}
              >
                <span style={{ fontSize: 11.5, fontWeight: 550 }}>{s.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); void killSession(s.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); void killSession(s.id); } }}
                  style={tabCloseStyle}
                  aria-label={`Kill ${s.label}`}
                >
                  <X size={10} />
                </span>
              </button>
            );
          })}
          <button onClick={createSession} disabled={creating} style={newTabStyle} title="New tmux session">
            <Plus size={11} /> {creating ? '…' : 'session'}
          </button>
        </div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={11} />} onClick={() => refreshList()}>
          refresh
        </Btn>
      </div>

      <div className="hermes-live-terminal-frame" style={terminalFrameStyle}>
        <style>{terminalFrameCss}</style>
        {/* Terminal canvas */}
        <div style={terminalCanvasStyle}>
          {!activeId && (
            <div style={emptyOverlay}>
              <TermIcon size={22} style={{ color: 'var(--muted)' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>No live session</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 360, textAlign: 'center' }}>
                Start a tmux-backed shell — windows persist across reconnects so you can detach and come back.
              </div>
              <Btn size="sm" variant="primary" icon={<Plus size={12} />} onClick={createSession} disabled={creating}>
                {creating ? 'Creating…' : 'New session'}
              </Btn>
            </div>
          )}
          <div ref={setTermHost} style={terminalHostStyle} />
        </div>

        {/* Window strip + tmux helpers */}
        {activeId && (
          <div style={windowStripStyle}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>windows</span>
            {windows.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
            ) : (
              windows.map((w) => (
                <button
                  key={w.index}
                  onClick={() => tmux({ action: 'select-window', windowIndex: w.index })}
                  style={windowTabStyle(w.active)}
                  title={`window ${w.index}: ${w.name}`}
                >
                  <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>{w.index}</span>
                  <span style={{ fontSize: 11.5 }}>{w.name}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void tmux({ action: 'kill-window', windowIndex: w.index }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); void tmux({ action: 'kill-window', windowIndex: w.index }); } }}
                    style={tabCloseStyle}
                    aria-label={`Kill window ${w.name}`}
                  >
                    <X size={10} />
                  </span>
                </button>
              ))
            )}
            <Btn size="sm" variant="ghost" icon={<Plus size={11} />} onClick={() => tmux({ action: 'new-window' })}>
              window
            </Btn>
            <span style={{ width: 1, height: 16, background: 'var(--hairline)', margin: '0 4px' }} />
            <Btn size="sm" variant="ghost" icon={<SplitSquareHorizontal size={11} />} onClick={() => tmux({ action: 'split-pane', direction: 'h' })}>
              split →
            </Btn>
            <Btn size="sm" variant="ghost" icon={<SplitSquareVertical size={11} />} onClick={() => tmux({ action: 'split-pane', direction: 'v' })}>
              split ↓
            </Btn>
            <Tag variant="default" icon={<Square size={9} />}>{cols(activeId, sessions)}×{rows(activeId, sessions)}</Tag>
          </div>
        )}
      </div>

    </div>
  );
}

// ---------- helpers ----------

// Terminal-emulator response sequences that xterm auto-generates when its
// parser sees the matching query. We must NEVER POST these as user input —
// the server pipes input straight to the shell, and the shell types out the
// printable bits as garbage like "1;2c" / "0;276;0c". Patterns covered:
//   DA1 reply  : ESC [ ? <params> c        e.g. \x1b[?1;2c
//   DA2 reply  : ESC [ > <params> c        e.g. \x1b[>0;276;0c
//   DSR cursor : ESC [ <row> ; <col> R     e.g. \x1b[24;80R
//   DSR status : ESC [ <n> n                e.g. \x1b[0n
//   DECRQM     : ESC [ ? <params> $ y / q   variant for mode reports
const EMULATOR_REPLY_RE = /\x1b\[(?:\?[\d;]*[chnq]|>[\d;]*c|\d+;\d+R|\?[\d;]*\$[yq])/g;
function stripEmulatorReplies(data: string): string {
  if (!data || data.indexOf('\x1b[') === -1) return data;
  return data.replace(EMULATOR_REPLY_RE, '');
}

function nextSessionLabel(sessions: LiveTerminalSession[]) {
  const taken = new Set(sessions.map((s) => s.label));
  for (let i = 1; i < 30; i++) {
    const l = `shell-${i}`;
    if (!taken.has(l)) return l;
  }
  return `shell-${Date.now() % 1000}`;
}

function cols(id: string, sessions: LiveTerminalSession[]) {
  return sessions.find((s) => s.id === id)?.cols ?? '?';
}
function rows(id: string, sessions: LiveTerminalSession[]) {
  return sessions.find((s) => s.id === id)?.rows ?? '?';
}

function terminalTheme() {
  return {
    background: cssToken('--terminal-bg', 'var(--terminal-bg)'),
    foreground: cssToken('--terminal-text', 'var(--terminal-text)'),
    cursor: cssToken('--terminal-cursor', 'var(--terminal-cursor)'),
    cursorAccent: cssToken('--terminal-bg', 'var(--terminal-bg)'),
    selectionBackground: cssToken('--terminal-selection', 'var(--terminal-selection)'),
    black: cssToken('--terminal-black', 'var(--terminal-black)'),
    red: cssToken('--terminal-red', 'var(--terminal-red)'),
    green: cssToken('--terminal-green', 'var(--terminal-green)'),
    yellow: cssToken('--terminal-yellow', 'var(--terminal-yellow)'),
    blue: cssToken('--terminal-blue', 'var(--terminal-blue)'),
    magenta: cssToken('--terminal-magenta', 'var(--terminal-magenta)'),
    cyan: cssToken('--terminal-cyan', 'var(--terminal-cyan)'),
    white: cssToken('--terminal-white', 'var(--terminal-white)'),
    brightBlack: cssToken('--terminal-bright-black', 'var(--terminal-bright-black)'),
    brightRed: cssToken('--terminal-bright-red', 'var(--terminal-bright-red)'),
    brightGreen: cssToken('--terminal-bright-green', 'var(--terminal-bright-green)'),
    brightYellow: cssToken('--terminal-bright-yellow', 'var(--terminal-bright-yellow)'),
    brightBlue: cssToken('--terminal-bright-blue', 'var(--terminal-bright-blue)'),
    brightMagenta: cssToken('--terminal-bright-magenta', 'var(--terminal-bright-magenta)'),
    brightCyan: cssToken('--terminal-bright-cyan', 'var(--terminal-bright-cyan)'),
    brightWhite: cssToken('--terminal-bright-white', 'var(--terminal-bright-white)'),
  };
}

function cssToken(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const stripStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--hairline)',
  flexWrap: 'wrap',
};

const terminalFrameStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  minHeight: 0,
  background: 'var(--terminal-bg)',
};

const terminalFrameCss = `
  .hermes-live-terminal-frame .xterm-screen,
  .hermes-live-terminal-frame .xterm-rows,
  .hermes-live-terminal-frame .xterm-rows > div {
    width: 100% !important;
  }

  .hermes-live-terminal-frame .xterm-rows > div:last-child:has(> .xterm-bg-2) {
    background: var(--terminal-green) !important;
  }
`;

const terminalCanvasStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 320,
  background: 'var(--terminal-bg)',
};

const terminalHostStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
};

const windowStripStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  flexShrink: 0,
  padding: '6px 8px',
  borderTop: '1px solid var(--hairline)',
  background: 'var(--surface-bg)',
  flexWrap: 'wrap',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 6px 4px 10px',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--panel-2)',
    color: active ? 'var(--accent)' : 'var(--value-text)',
    cursor: 'pointer',
    transition: 'background 180ms cubic-bezier(.2,.7,.2,1), border-color 180ms cubic-bezier(.2,.7,.2,1), color 180ms cubic-bezier(.2,.7,.2,1)',
  };
}

function windowTabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 6px 3px 8px',
    borderRadius: 5,
    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--value-text)',
    cursor: 'pointer',
  };
}

const newTabStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px dashed var(--line)',
  background: 'transparent',
  color: 'var(--muted)',
  cursor: 'pointer',
  fontSize: 11,
};

const tabCloseStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16, borderRadius: 4,
  color: 'var(--muted-2)',
  cursor: 'pointer',
};

const emptyOverlay: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 2,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
  background: 'var(--bg-soft)',
};

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  background: 'var(--panel-2)',
  border: '1px solid var(--line)',
  padding: '0 6px',
  borderRadius: 4,
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: 'var(--muted)', minHeight: 280 }}>
      {children}
    </div>
  );
}
