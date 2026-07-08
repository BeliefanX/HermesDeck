/* global React, HD */
const { useState, useRef, useEffect } = React;

const INITIAL_SESSIONS = [
  { id: 's1', title: 'Deck projection — stream recovery', model: 'claude-haiku-4-5', pinned: true, when: '12m', tags: ['active'] },
  { id: 's2', title: 'Live Terminal session review',      model: 'gpt-4o',          pinned: false, when: '3h', tags: ['running'] },
  { id: 's3', title: 'PWA offline strategy',            model: 'claude-haiku-4-5', pinned: false, when: '1d', tags: [] },
  { id: 's4', title: 'Agent model catalog review',       model: 'deepseek-v3',     pinned: false, when: '2d', tags: [] },
  { id: 's5', title: 'Toolset discovery review',    model: 'claude-haiku-4-5', pinned: false, when: '4d', tags: [] },
  { id: 's6', title: 'Mermaid + KaTeX render pipeline', model: 'gpt-4o',          pinned: false, when: '6d', tags: [] },
];

const INITIAL_MESSAGES = [
  {
    id: 'm1', role: 'user',
    body: '帮我看一下 Deck BFF 怎么从 Hermes Agent API 流更新投影，我担心刷新后工具卡片丢失。',
    when: '12m ago',
  },
  {
    id: 'm2', role: 'assistant',
    body: 'HermesDeck uses two layers:\n\n- `/v1/runs/{run_id}/events` — Agent API stream source\n- `run-event` — browser-visible tool/status events\n\nThe BFF forwards run events and updates the Deck-owned projection only at semantic boundaries such as assistant draft/final text, tool-call arguments done, and tool-result output. Browser reconnects use the Stream Hub resume path, then messages/projection polling can recover visible draft and tool rows.',
    when: '11m ago',
    code: {
      lang: 'typescript',
      content: 'await writer.write(`${JSON.stringify(evt)}\\n`)\nif (Date.now() - lastFsync > 250) {\n  await fh.sync()\n  lastFsync = Date.now()\n}',
    },
  },
];

const SLASH_COMMANDS = [
  { cmd: '/run',     desc: 'Use supported Deck command actions', icon: 'play' },
  { cmd: '/profile', desc: 'Switch execution profile',                icon: 'bot' },
  { cmd: '/model',   desc: 'Switch model',                            icon: 'cpu' },
  { cmd: '/clear',   desc: 'Clear current thread',                    icon: 'inbox' },
  { cmd: '/copy',    desc: 'Copy last response',                      icon: 'copy' },
];

function SessionsPanel({ sessions, activeId, onSelect, onNew }) {
  const [q, setQ] = useState('');
  const filtered = sessions.filter(s => s.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <HD.Kicker>CONVERSATIONS</HD.Kicker>
          <HD.Btn size="sm" icon="plus" onClick={onNew}>New</HD.Btn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <HD.Icon name="search" size={12} color="var(--muted-2)"/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions…" style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)',
            fontSize: 12.5, fontFamily: 'var(--font-sans)',
          }}/>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {filtered.map(s => (
          <div key={s.id} onClick={() => onSelect(s.id)} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '10px 10px',
            borderRadius: 8, cursor: 'pointer',
            background: s.id === activeId ? 'var(--glass-strong)' : 'transparent',
            borderLeft: s.id === activeId ? '2px solid rgba(56,189,248,.55)' : '2px solid transparent',
            paddingLeft: 10,
            marginBottom: 2,
          }}
            onMouseEnter={(e) => { if (s.id !== activeId) e.currentTarget.style.background = 'var(--glass)'; }}
            onMouseLeave={(e) => { if (s.id !== activeId) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.pinned && <HD.Icon name="pin" size={11} color="var(--accent)"/>}
              <span style={{ fontSize: 12.5, color: 'var(--strong-text)', fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{s.title}</span>
              <span style={{ fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{s.when}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{s.model}</span>
              {s.tags.includes('active')  && <HD.Tag variant="accent" style={{ fontSize: 9.5 }}>active</HD.Tag>}
              {s.tags.includes('running') && <HD.Tag variant="green"  style={{ fontSize: 9.5 }}>running</HD.Tag>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeFence({ lang, content }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-soft)', margin: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--panel-3)', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted-2)', letterSpacing: '.04em', textTransform: 'lowercase' }}>{lang}</span>
        <button onClick={() => { navigator.clipboard?.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1200); }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px',
          borderRadius: 5, border: '1px solid var(--line)', background: 'transparent',
          color: copied ? 'var(--green)' : 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: 10.5, cursor: 'pointer',
        }}>
          <HD.Icon name={copied ? 'check' : 'copy'} size={11}/>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 14, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, color: 'var(--text)', overflowX: 'auto' }}>
        {content}
      </pre>
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: isUser ? 'var(--accent)' : 'var(--muted-2)', fontWeight: 500 }}>
          {isUser ? 'YOU' : 'CLAUDE-HAIKU-4-5'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{msg.when}</span>
        {!isUser && <HD.Tag variant="green" style={{ fontSize: 9.5 }} icon="check">complete</HD.Tag>}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{msg.body}</div>
      {msg.code && <CodeFence lang={msg.code.lang} content={msg.code.content}/>}
      {!isUser && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <HD.Btn size="sm" variant="ghost" icon="copy">Copy</HD.Btn>
          <HD.Btn size="sm" variant="ghost" icon="check">Good</HD.Btn>
          <HD.Btn size="sm" variant="ghost" icon="more"/>
        </div>
      )}
    </div>
  );
}

function Composer({ onSend }) {
  const [v, setV] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setOpen(v.startsWith('/') && v.length <= 16 && !v.includes(' '));
  }, [v]);
  const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(v.toLowerCase()));
  const send = () => { if (v.trim()) { onSend(v); setV(''); } };
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px 18px', background: 'var(--bg)', position: 'relative' }}>
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 18, right: 18,
          background: 'var(--panel)', border: '1px solid var(--line-strong)', borderRadius: 10,
          boxShadow: 'var(--shadow-pop)', overflow: 'hidden', maxWidth: 480,
        }}>
          {filtered.map((c, i) => (
            <div key={c.cmd} onClick={() => setV(c.cmd + ' ')} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', cursor: 'pointer',
              borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
              background: i === 0 ? 'var(--glass)' : 'transparent',
            }}>
              <HD.Icon name={c.icon} size={13} color="var(--accent)"/>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--strong-text)', fontWeight: 500 }}>{c.cmd}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{c.desc}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 12, background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 12,
      }}>
        <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask Hermes anything. Use / for commands, @ for tools…"
          rows={2}
          style={{
            width: '100%', resize: 'none', background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.55,
          }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HD.Btn size="sm" variant="ghost" icon="paperclip"/>
          <HD.Btn size="sm" variant="ghost" icon="sparkles">slash</HD.Btn>
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>claude-haiku-4-5 · profile: <span style={{ color: 'var(--accent)' }}>staging</span></span>
          <HD.Btn variant="primary" icon="send" onClick={send} disabled={!v.trim()}>Send</HD.Btn>
        </div>
      </div>
    </div>
  );
}

function Timeline({ messages }) {
  return (
    <div style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--line)', background: 'var(--bg)', padding: 14, overflowY: 'auto' }}>
      <HD.Kicker style={{ marginBottom: 12 }}>RUN TIMELINE</HD.Kicker>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 1, background: 'var(--hairline)' }}/>
        {messages.map((m, i) => (
          <div key={m.id} style={{ position: 'relative', paddingLeft: 22, paddingBottom: 16 }}>
            <div style={{
              position: 'absolute', left: 3, top: 4, width: 9, height: 9, borderRadius: '50%',
              background: m.role === 'user' ? 'var(--accent)' : 'var(--green)',
              boxShadow: `0 0 0 3px ${m.role === 'user' ? 'rgba(56,189,248,.18)' : 'rgba(34,197,94,.16)'}`,
            }}/>
            <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted-2)', fontWeight: 500, marginBottom: 2 }}>
              {m.role === 'user' ? 'PROMPT' : 'RESPONSE'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--value-text)', lineHeight: 1.45, fontFamily: 'var(--font-mono)' }}>{m.when}</div>
            {m.code && <div style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>+ code · {m.code.lang}</div>}
          </div>
        ))}
        <div style={{ position: 'relative', paddingLeft: 22 }}>
          <div style={{
            position: 'absolute', left: 3, top: 4, width: 9, height: 9, borderRadius: '50%',
            background: 'var(--muted-2)', border: '2px dashed var(--muted-2)',
          }}/>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Waiting for next message…</div>
        </div>
      </div>
    </div>
  );
}

function ChatView() {
  const [sessions] = useState(INITIAL_SESSIONS);
  const [activeId, setActiveId] = useState('s1');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const active = sessions.find(s => s.id === activeId) || sessions[0];

  const send = (body) => {
    setMessages(prev => [
      ...prev,
      { id: 'u' + Date.now(), role: 'user', body, when: 'just now' },
    ]);
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { id: 'a' + Date.now(), role: 'assistant',
          body: 'Got it. Let me look at the current session context, then I\'ll come back with a full plan.',
          when: 'just now' },
      ]);
    }, 800);
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--bg)' }}>
      <SessionsPanel sessions={sessions} activeId={activeId} onSelect={setActiveId} onNew={() => {}}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--line)' }}>
        {/* Thread header */}
        <div style={{ height: 48, padding: '0 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--strong-text)' }}>{active.title}</span>
          <HD.Tag variant="accent" style={{ fontSize: 9.5 }}>{active.model}</HD.Tag>
          <span style={{ flex: 1 }}/>
          <HD.Btn size="sm" variant="ghost" icon="archive"/>
          <HD.Btn size="sm" variant="ghost" icon="more"/>
        </div>
        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px 8px' }}>
          {messages.map(m => <Message key={m.id} msg={m}/>)}
        </div>
        <Composer onSend={send}/>
      </div>
      <Timeline messages={messages}/>
    </div>
  );
}

window.HDChat = { ChatView };
