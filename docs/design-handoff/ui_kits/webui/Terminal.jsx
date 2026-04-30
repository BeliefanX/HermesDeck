/* global React, HD */
const { useState } = React;

const ALLOWLIST = [
  { name: 'git status',         desc: 'Current repo status',                 icon: 'pulse' },
  { name: 'git diff --stat',    desc: 'Summary of staged/unstaged diffs',    icon: 'pulse' },
  { name: 'rg <pattern>',       desc: 'Read-only full-text search',          icon: 'search' },
  { name: 'ls <path>',          desc: 'List directory (within allowlist)',   icon: 'archive' },
  { name: 'pnpm typecheck',     desc: 'Type-check (60s timeout)',            icon: 'shield' },
];

const OUTPUT = [
  { type: 'cmd', text: '$ git status' },
  { type: 'out', text: 'On branch main\nYour branch is up to date with \'origin/main\'.\n\nChanges not staged for commit:\n  modified:   src/app/chat/page.tsx\n  modified:   src/components/Composer.tsx\n\nno changes added to commit (use "git add" and/or "git commit -a")' },
  { type: 'cmd', text: '$ rg "shell:false" src/' },
  { type: 'out', text: 'src/app/api/terminal/route.ts:42:    spawn(cmd, args, { shell: false })\nsrc/app/api/terminal/route.ts:88:    // shell:false enforced by allowlist' },
];

function Terminal() {
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(ALLOWLIST[0].name);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      {/* Hero */}
      <HD.Card hero>
        <HD.Kicker style={{ marginBottom: 8 }}>SAFE OPS CONSOLE</HD.Kicker>
        <h1 style={{ fontSize: 26, lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.035em', color: 'var(--strong-text)', margin: '0 0 8px' }}>
          Not a raw web shell — a governed terminal
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 620 }}>
          HermesDeck&rsquo;s safe terminal only runs server-side allowlisted actions, executes with{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>shell:false</span>,{' '}
          and applies timeout, truncation and secret-redaction automatically. Free-form commands are intentionally not accepted — this is not a remote shell.
        </p>
      </HD.Card>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14 }}>
        {/* Allowlist */}
        <HD.Card padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <HD.Kicker>ALLOWLIST</HD.Kicker>
            <HD.Tag variant="green" icon="shield">5 verbs</HD.Tag>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ALLOWLIST.map(c => (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>timeout</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>60s</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>truncate</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--value-text)' }}>4 KB</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}><span>shell</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>false</span></div>
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
