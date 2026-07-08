/* global React, HD */

const SPARK = [42, 31, 58, 24, 72, 38, 65, 80, 42, 91, 55, 73, 88, 100];
const TOPMODELS = [
  { name: 'claude-haiku-4-5', count: 412, max: 412 },
  { name: 'gpt-4o',           count: 253, max: 412 },
  { name: 'deepseek-v3',      count: 147, max: 412 },
  { name: 'gemini-2.5-flash', count:  88, max: 412 },
];
const SESSIONS = [
  { id: 1, title: 'BFF replay buffer — disk persistence', model: 'claude-haiku-4-5', when: '12m ago', tags: ['active'] },
  { id: 2, title: 'Live Terminal session · SSE stream', model: 'gpt-4o',            when: '3h ago',  tags: ['running'] },
  { id: 3, title: 'PWA offline strategy & SW cache',         model: 'claude-haiku-4-5', when: '1d ago',  tags: [] },
  { id: 4, title: 'Models config page scaffold',             model: 'deepseek-v3',      when: '2d ago',  tags: [] },
];

function HeroCard() {
  return (
    <HD.Card hero style={{ padding: 22 }}>
      <HD.Kicker style={{ marginBottom: 8 }}>COMMAND DECK</HD.Kicker>
      <h1 style={{
        fontSize: 30, lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.035em',
        color: 'var(--strong-text)', margin: '0 0 8px',
      }}>Hermes control deck</h1>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 540 }}>
        Multi-session chat workbench. Agents, Tools and Live Terminal in one console.
        Run data comes from Hermes Agent API, Deck projection and local metadata — zero hard-coding in the frontend.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <HD.Btn variant="primary" icon="message">Open chat</HD.Btn>
        <HD.Btn icon="terminal">Open terminal</HD.Btn>
      </div>
    </HD.Card>
  );
}

function MetricsRow() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <HD.MetricCard kicker="SESSIONS · 24H" value="142" delta="+18%" deltaTone="green" sub="vs prev period"/>
      <HD.MetricCard kicker="TOKENS · 24H"    value="1.2M" delta="+9%"  deltaTone="green" sub="in / out"/>
      <HD.MetricCard kicker="COST · 14D"      value="$2.34" delta="−12%" deltaTone="green" sub="model spend"/>
      <HD.MetricCard kicker="TOOLS"           value="38"   delta="live" deltaTone="green" sub="skills · MCP"/>
    </div>
  );
}

function SparkCard() {
  return (
    <HD.Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <HD.Kicker>SESSIONS · 14D</HD.Kicker>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Mon · Tue · Wed · Thu · Fri</span>
      </div>
      <HD.Sparkline values={SPARK}/>
      <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
        <div><HD.Kicker>PEAK</HD.Kicker><div style={{ fontSize: 18, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums' }}>100<span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>sessions</span></div></div>
        <div><HD.Kicker>AVG</HD.Kicker><div style={{ fontSize: 18, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums' }}>61</div></div>
        <div><HD.Kicker>FAIL RATE</HD.Kicker><div style={{ fontSize: 18, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums' }}>3.4<span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 1 }}>%</span></div></div>
      </div>
    </HD.Card>
  );
}

function TopModelsCard() {
  return (
    <HD.Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <HD.Kicker>TOP MODELS · 14D</HD.Kicker>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>900 sessions</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TOPMODELS.map(m => <HD.BarRow key={m.name} label={m.name} value={m.count} max={m.max} raw={m.count}/>)}
      </div>
    </HD.Card>
  );
}

function SessionsCard({ onOpen }) {
  return (
    <HD.Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <HD.Kicker>RECENT SESSIONS</HD.Kicker>
        <a style={{ fontSize: 11.5, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' }} onClick={onOpen}>View all →</a>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {SESSIONS.map((s, i) => (
          <div key={s.id} onClick={onOpen} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
            padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
            cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 550, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{s.model} · {s.when}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {s.tags.includes('active')  && <HD.Tag variant="accent">active</HD.Tag>}
              {s.tags.includes('running') && <HD.Tag variant="green">running</HD.Tag>}
            </div>
            <HD.Icon name="chevR" size={14} color="var(--muted-2)"/>
          </div>
        ))}
      </div>
    </HD.Card>
  );
}

function Dashboard({ onOpenChat }) {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      <HeroCard/>
      <MetricsRow/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SparkCard/>
        <TopModelsCard/>
      </div>
      <SessionsCard onOpen={onOpenChat}/>
    </div>
  );
}

window.HDDashboard = { Dashboard };
