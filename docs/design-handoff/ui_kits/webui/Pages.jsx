/* global React, HD */
// Page-level prototype recreations. Product behavior and bilingual copy live in src/app/*.
// Source files: tools/page.tsx, settings/page.tsx, offline/page.tsx.
const { useState, useMemo } = React;

// Shared layout primitives ─────────────────────────────────────────────
function Page({ children, intro }) {
  return (
    <div style={{
      padding: 'clamp(16px, 1.8vw, 28px)',
      display: 'flex', flexDirection: 'column', gap: 14,
      maxWidth: 1280, margin: '0 auto', width: '100%',
      boxSizing: 'border-box',
    }}>
      {intro && (
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 760 }}>
          {intro}
        </p>
      )}
      {children}
    </div>
  );
}

function Kbd({ children }) {
  return <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11.5,
    padding: '1px 6px', borderRadius: 4,
    background: 'var(--panel-2)', border: '1px solid var(--line)',
    color: 'var(--value-text)',
  }}>{children}</span>;
}

function SectionHead({ kicker, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {kicker && <HD.Kicker>{kicker}</HD.Kicker>}
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 620, letterSpacing: '-.012em', color: 'var(--strong-text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{title}</h2>
      </div>
      {right && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// ─── MODELS ─────────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: 'anthropic', name: 'Anthropic', isDefault: true, credentialCount: 2,
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-haiku-4-5',    tokens: 1240000, sessions: 142, lastUsed: 'just now',  isDefault: true },
      { id: 'claude-sonnet-4-5',   tokens:  680000, sessions:  58, lastUsed: '2h ago',   isDefault: false },
      { id: 'claude-opus-4-1',     tokens:  120000, sessions:  12, lastUsed: '3d ago',   isDefault: false },
    ],
  },
  {
    id: 'openai', name: 'OpenAI', isDefault: false, credentialCount: 1,
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o',     tokens: 540000, sessions:  74, lastUsed: '3h ago', isDefault: false },
      { id: 'gpt-4o-mini', tokens: 88000, sessions:  41, lastUsed: '1d ago', isDefault: false },
    ],
  },
];
const ORPHAN_MODELS = [
  { id: 'deepseek-v3',     tokens: 92000, sessions: 18, lastUsed: '5d ago', isDefault: false },
  { id: 'gemini-2.5-flash',tokens: 41000, sessions: 11, lastUsed: '1w ago', isDefault: false },
];

function fmtTokens(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

function ModelRow({ model, maxTokens }) {
  const pct = maxTokens > 0 ? ((model.tokens || 0) / maxTokens) * 100 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,2fr) auto', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <HD.Icon name="cpu" size={12} color={model.isDefault ? 'var(--accent)' : 'var(--muted)'}/>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          fontWeight: model.isDefault ? 600 : 500,
          color: model.isDefault ? 'var(--accent)' : 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{model.id}</span>
        {model.isDefault && <HD.Icon name="star" size={10} color="var(--accent)"/>}
      </div>
      <div style={{ height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }}/>
      </div>
      <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--value-text)' }}>{fmtTokens(model.tokens)}</span>
        <span style={{ color: 'var(--muted-2)' }}>{model.sessions} sessions</span>
        <span style={{ color: 'var(--muted-2)' }}>{model.lastUsed}</span>
      </div>
    </div>
  );
}

function ProviderCard({ provider }) {
  const totalSessions = provider.models.reduce((s, m) => s + (m.sessions || 0), 0);
  const totalTokens = provider.models.reduce((s, m) => s + (m.tokens || 0), 0);
  const maxTokens = Math.max(...provider.models.map(m => m.tokens || 0), 1);
  return (
    <HD.Card>
      <SectionHead
        kicker={provider.id}
        title={<>
          <HD.Icon name="server" size={15} color="var(--accent)"/>
          {provider.name}
          {provider.isDefault && <HD.Tag variant="green" icon="star">default</HD.Tag>}
        </>}
        right={<>
          <HD.Tag icon="key">{provider.credentialCount} creds</HD.Tag>
          <HD.Tag icon="cpu">{provider.models.length} models</HD.Tag>
        </>}
      />
      <div style={{ display: 'flex', gap: 24, padding: '10px 0', borderTop: '1px solid var(--hairline)', borderBottom: '1px solid var(--hairline)', marginBottom: 6, flexWrap: 'wrap' }}>
        <div><HD.Kicker>SESSIONS</HD.Kicker><div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{totalSessions.toLocaleString()}</div></div>
        <div><HD.Kicker>TOKENS</HD.Kicker><div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtTokens(totalTokens)}</div></div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <HD.Kicker>BASE_URL</HD.Kicker>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--value-text)', wordBreak: 'break-all', marginTop: 4 }}>{provider.baseUrl}</div>
        </div>
      </div>
      <div>
        {provider.models.map(m => <ModelRow key={m.id} model={m} maxTokens={maxTokens}/>)}
      </div>
    </HD.Card>
  );
}

function ModelsPage() {
  const totals = useMemo(() => {
    let models = 0, tokens = 0, withCreds = 0;
    PROVIDERS.forEach(p => {
      models += p.models.length;
      tokens += p.models.reduce((s, m) => s + (m.tokens || 0), 0);
      if (p.credentialCount > 0) withCreds += 1;
    });
    return { providers: PROVIDERS.length, models, tokens, withCreds };
  }, []);
  const def = PROVIDERS[0].models.find(m => m.isDefault);

  return (
    <Page intro={<>Currently connected providers and their previously used models. Data sourced from Hermes Agent API, Deck projection and local metadata.</>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <HD.MetricCard kicker="PROVIDERS" value={totals.providers} sub={`${totals.withCreds} with credentials`}/>
        <HD.MetricCard kicker="MODELS"    value={totals.models}    sub="used or set as default"/>
        <HD.MetricCard kicker="TOKENS · ALL TIME" value={fmtTokens(totals.tokens)} sub="across providers × models"/>
      </div>

      {def && (
        <HD.Card hero>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <HD.Kicker>DEFAULT MODEL</HD.Kicker>
              <h2 style={{ margin: '6px 0 6px', fontSize: 20, fontWeight: 650, letterSpacing: '-.018em', color: 'var(--strong-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <HD.Icon name="star" size={16} color="var(--accent)"/>
                {def.id}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>provider · <Kbd>{PROVIDERS[0].id}</Kbd></span>
                <span>base_url · <Kbd>{PROVIDERS[0].baseUrl}</Kbd></span>
              </div>
            </div>
            <HD.Tag variant="green" icon="sparkles">currently active</HD.Tag>
          </div>
        </HD.Card>
      )}

      {PROVIDERS.map(p => <ProviderCard key={p.id} provider={p}/>)}

      {ORPHAN_MODELS.length > 0 && (
        <HD.Card>
          <SectionHead
            kicker="NO PROVIDER TAG"
            title="Orphan models from session history"
            right={<HD.Tag icon="database">{ORPHAN_MODELS.length}</HD.Tag>}
          />
          {ORPHAN_MODELS.map(m => <ModelRow key={m.id} model={m} maxTokens={Math.max(...ORPHAN_MODELS.map(x => x.tokens || 0), 1)}/>)}
        </HD.Card>
      )}
    </Page>
  );
}

// ─── TOOLS ──────────────────────────────────────────────────────────────
const TOOLS = [
  { name: 'fs.read',           kind: 'toolset', description: 'Read a file from approved workspace roots.' },
  { name: 'fs.search',         kind: 'toolset', description: 'Ripgrep-backed full-text search across mounted folders.' },
  { name: 'web.fetch',         kind: 'toolset', description: 'GET an exact URL; returns extracted text.' },
  { name: 'design-system',     kind: 'skill',   description: 'Apply HermesDeck brand tokens to a generated artifact.' },
  { name: 'render-mermaid',    kind: 'skill',   description: 'Render a Mermaid graph to SVG inside the chat thread.' },
  { name: 'github',            kind: 'mcp',     description: 'GitHub MCP server — repo / tree / file operations.' },
  { name: 'linear',            kind: 'mcp',     description: 'Linear MCP server — issues, projects, comments.' },
];

function ToolsPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');

  const kinds = useMemo(() => Array.from(new Set(TOOLS.map(t => t.kind))), []);
  const filtered = TOOLS.filter(t => {
    if (kind !== 'all' && t.kind !== kind) return false;
    if (!q) return true;
    return (t.name + ' ' + t.description).toLowerCase().includes(q.toLowerCase());
  });

  const KIND_ICON = { toolset: 'wrench', skill: 'sparkles', mcp: 'plug', unknown: 'boxes' };

  return (
    <Page intro="Tools, skills and MCP capabilities discovered from Hermes at runtime. The frontend never hard-codes a capability list.">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 36,
        padding: '0 12px', background: 'var(--bg-soft)',
        border: '1px solid var(--line)', borderRadius: 8,
      }}>
        <HD.Icon name="search" size={14} color="var(--muted-2)"/>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search tool, skill or MCP server"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13 }}/>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={kind === 'all'} onClick={() => setKind('all')}>All ({TOOLS.length})</Chip>
        {kinds.map(k => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)} icon={KIND_ICON[k] || 'boxes'}>
            {k} ({TOOLS.filter(t => t.kind === k).length})
          </Chip>
        ))}
      </div>

      <HD.Card padding={6}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '32px 0', color: 'var(--muted)' }}>
            <HD.Icon name="wrench" size={20}/>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>No matches</span>
            <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{TOOLS.length === 0 ? 'Hermes Agent API did not return a tools/skills list.' : 'Try a shorter keyword or another category.'}</span>
          </div>
        ) : filtered.map((t, i) => (
          <div key={t.name + i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
          }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--surface-bg)', border: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', flexShrink: 0,
            }}><HD.Icon name={KIND_ICON[t.kind] || 'boxes'} size={14}/></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)', fontFamily: 'var(--font-mono)' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
            </div>
            <HD.Tag>{t.kind}</HD.Tag>
          </div>
        ))}
      </HD.Card>
    </Page>
  );
}

function Chip({ children, active, onClick, icon }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: 28, padding: '0 10px',
      borderRadius: 999, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
      border: '1px solid', cursor: 'pointer', transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
      background: active ? 'var(--accent-soft)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--muted)',
      borderColor: active ? 'var(--accent-border)' : 'var(--line)',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {icon && <HD.Icon name={icon} size={11}/>}
      {children}
    </button>
  );
}

// ─── SETTINGS ───────────────────────────────────────────────────────────
function SettingsPage({ theme, setTheme }) {
  const [cleared, setCleared] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const apiHealthy = true;
  const catalogHealthy = true;
  const storageKb = 14.2;

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  };
  const clear = () => {
    setCleared(true);
    setTimeout(() => setCleared(false), 2400);
  };

  return (
    <Page intro="Basics: theme, connection info, local cache. Sensitive config preview/edit flows use guarded Deck BFF routes and remain admin-scoped.">
      <HD.Card>
        <SectionHead kicker="APPEARANCE" title="Theme"/>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>Theme persists in the browser and is replayed by the SSR bootstrap script to avoid flashes.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={theme === 'dark'} onClick={() => setTheme('dark')} icon="moon">Dark</Chip>
          <Chip active={theme === 'light'} onClick={() => setTheme('light')} icon="sun">Light</Chip>
          <Chip onClick={() => setTheme('dark')} icon="monitor">Follow system</Chip>
        </div>
      </HD.Card>

      <HD.Card>
        <SectionHead
          kicker="BACKEND"
          title="Hermes connections"
          right={<HD.Btn size="sm" icon="refresh" onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</HD.Btn>}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <SettingsRow icon="server" name="Hermes Agent API" sub="http://127.0.0.1:8642" right={<HD.Tag variant={apiHealthy ? 'green' : 'yellow'}>{apiHealthy ? 'Healthy' : 'Unavailable'}</HD.Tag>} first/>
          <SettingsRow icon="database" name="Agent catalog" sub="/v1/profiles · /api/profiles" right={<HD.Tag variant={catalogHealthy ? 'green' : 'yellow'}>{catalogHealthy ? 'API-backed' : 'Unavailable'}</HD.Tag>}/>
        </div>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-bg)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <HD.Kicker style={{ marginBottom: 8 }}>ENV VARS · SECRETS REDACTED</HD.Kicker>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div>API server: <Kbd>HERMES_API_BASE</Kbd></div>
            <div>Auth: <Kbd>HERMES_API_KEY</Kbd> · <Kbd>API_SERVER_KEY</Kbd></div>
          </div>
        </div>
      </HD.Card>

      <HD.Card>
        <SectionHead kicker="LOCAL CACHE" title="Browser-stored state"/>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: 620 }}>
          HermesDeck keeps drafts, the session index and response_id chains in the browser, so offline browsing and assigned-Agent switching feel snappy.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <HD.Tag icon="shieldCheck">on-device only</HD.Tag>
          <HD.Tag>~ {storageKb.toFixed(1)} KB</HD.Tag>
          <HD.Btn variant="danger" icon="trash" onClick={clear}>Clear HermesDeck cache</HD.Btn>
          {cleared && <HD.Tag variant="green">Cleared</HD.Tag>}
        </div>
      </HD.Card>
    </Page>
  );
}

function SettingsRow({ icon, name, sub, right, first }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderTop: first ? 'none' : '1px solid var(--hairline)',
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 10,
        background: 'var(--surface-bg)', border: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', flexShrink: 0,
      }}><HD.Icon name={icon} size={14}/></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>{name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      {right}
    </div>
  );
}

// ─── OFFLINE ────────────────────────────────────────────────────────────
function OfflinePage() {
  return (
    <Page>
      <HD.Card hero>
        <HD.Kicker>HERMESDECK PWA</HD.Kicker>
        <h1 style={{ margin: '6px 0 10px', fontSize: 28, fontWeight: 650, letterSpacing: '-.03em', color: 'var(--strong-text)' }}>You&rsquo;re offline</h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
          The app shell is cached and previously loaded pages stay readable. Chat, terminal and Hermes API operations need you back on the same network.
        </p>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 12, marginTop: 18,
          background: 'var(--surface-bg)', border: '1px solid var(--line)', borderRadius: 8,
        }}>
          <HD.Icon name="wifiOff" size={16} color="var(--muted)"/>
          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Make sure this device is on the same network as the HermesDeck host.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <HD.Btn variant="primary" icon="refresh">Retry connection</HD.Btn>
        </div>
      </HD.Card>
    </Page>
  );
}

window.HDPages = { ModelsPage, ToolsPage, SettingsPage, OfflinePage };
