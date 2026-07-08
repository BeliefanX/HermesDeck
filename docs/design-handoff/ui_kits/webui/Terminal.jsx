/* global React, HD */
const { useState } = React;

const WINDOWS = [
  { name: 'main shell',         desc: 'Live PTY session',                    icon: 'terminal' },
  { name: 'split: tests',       desc: 'Second tmux pane',                    icon: 'pulse' },
  { name: 'split: logs',        desc: 'Tail server output',                  icon: 'search' },
  { name: 'new window',         desc: 'Create another terminal window',      icon: 'archive' },
  { name: 'stop session',       desc: 'End the active controlled session',   icon: 'shield' },
];

const OUTPUT = [
  { type: 'cmd', text: '$ npm run typecheck' },
  { type: 'out', text: '> hermesdeck@0.1.0 typecheck\n> tsc --noEmit\n\n✓ clean' },
  { type: 'cmd', text: '$ tmux split-window -h' },
  { type: 'out', text: '[window split] streaming PTY output through Deck BFF' },
];

function Terminal() {
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(WINDOWS[0].name);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      {/* Hero */}
      <HD.Card hero>
        <HD.Kicker style={{ marginBottom: 8 }}>LIVE TERMINAL</HD.Kicker>
        <h1 style={{ fontSize: 26, lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.035em', color: 'var(--strong-text)', margin: '0 0 8px' }}>
          Controlled terminal for trusted operators
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 620 }}>
          HermesDeck streams tmux-backed Live Terminal sessions through the Deck BFF, with explicit
          server opt-in, bounded session/subscriber counts, SSE replay and secret-stripped child environments.
          Grant it only to trusted super_admin users.
        </p>
      </HD.Card>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14 }}>
        {/* Session controls */}
        <HD.Card padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <HD.Kicker>WINDOWS</HD.Kicker>
            <HD.Tag variant="green" icon="shield">controlled</HD.Tag>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {WINDOWS.map(c => (
              <div key={c.name} onClick={() => setSelected(c.name)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                background: selected === c.name ? 'var(--glass-strong)' : 'transparent',
                borderLeft: selected === c.name ? '2px solid rgba(56,189,248,.55)' : '2px solid transparent',
              }}>
                <HD.Icon name={c.icon} size={13} color={selected === c.name ? 'var(--accent)' : 'var(--muted)'} style={{ flexShrink: 0 }}/>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--strong-text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>sessions</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>max 8</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>replay</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>256 KB</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>stream</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>SSE</span></div>
          </div>
        </HD.Card>

        {/* Output */}
        <HD.Card padding={0}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--hairline)' }}>
            <HD.Icon name="terminal" size={14} color="var(--muted)"/>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--value-text)' }}>{selected}</span>
            <span style={{ flex: 1 }}/>
            <HD.Btn size="sm" variant="primary" icon="play" onClick={() => { setRunning(true); setTimeout(() => setRunning(false), 1200); }}>
              {running ? 'Running…' : 'Run'}
            </HD.Btn>
            <HD.Btn size="sm" variant="ghost">Clear output</HD.Btn>
          </div>
          <div style={{ padding: 14, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55, color: 'var(--text)', minHeight: 280, background: 'var(--bg-soft)', borderRadius: '0 0 10px 10px' }}>
            {OUTPUT.map((o, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                {o.type === 'cmd'
                  ? <div style={{ color: 'var(--accent)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{o.text}</div>
                  : <pre style={{ margin: 0, color: 'var(--value-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{o.text}</pre>}
              </div>
            ))}
            {running && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--muted)' }}>
                <span style={{ display: 'inline-block', width: 6, height: 14, background: 'var(--accent)', animation: 'blink 1s steps(2,start) infinite' }}/>
              </div>
            )}
          </div>
        </HD.Card>
      </div>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}

window.HDTerminal = { Terminal };
