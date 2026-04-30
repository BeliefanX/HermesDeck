'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckModelsResponse, ModelInfo, ProviderInfo } from '@/lib/types';
import {
  Cpu, Server, Star, Database, Activity, Plug, KeyRound, AlertCircle, Sparkles,
} from 'lucide-react';

function fmtTokens(n?: number): string {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function relTime(iso?: string): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ModelsPage() {
  const [data, setData] = useState<DeckModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    let alive = true;
    deckApi.models()
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const totals = useMemo(() => {
    if (!data) return { providers: 0, models: 0, tokens: 0, withCreds: 0 };
    let models = 0; let tokens = 0; let withCreds = 0;
    for (const p of data.providers) {
      models += p.models.length;
      tokens += p.models.reduce((s, m) => s + (m.tokens || 0), 0);
      if ((p.credentialCount || 0) > 0) withCreds += 1;
    }
    return { providers: data.providers.length, models, tokens, withCreds };
  }, [data]);

  return (
    <div className="page grid">
      <p className="page-intro">
        Currently connected providers and their previously used models. Data sourced from
        <span className="kbd" style={{ margin: '0 4px' }}>hermes auth list</span>,
        <span className="kbd" style={{ margin: '0 4px' }}>~/.hermes/config.yaml</span> and the sessions table in state.db.
      </p>

      {/* Header metrics */}
      <div className="grid cols-3">
        <div className="card metric-card hover-lift">
          <div className="metric-top"><span className="metric-icon"><Plug size={18} /></span><span className="metric-label">Providers</span></div>
          <div className="metric">{loading ? '—' : totals.providers}</div>
          <div className="muted small">{loading ? 'Loading…' : `${totals.withCreds} with credentials`}</div>
        </div>
        <div className="card metric-card hover-lift">
          <div className="metric-top"><span className="metric-icon"><Cpu size={18} /></span><span className="metric-label">Models</span></div>
          <div className="metric">{loading ? '—' : totals.models}</div>
          <div className="muted small">used or set as default</div>
        </div>
        <div className="card metric-card hover-lift">
          <div className="metric-top"><span className="metric-icon"><Activity size={18} /></span><span className="metric-label">Tokens · all time</span></div>
          <div className="metric">{loading ? '—' : fmtTokens(totals.tokens)}</div>
          <div className="muted small">across providers × models</div>
        </div>
      </div>

      {/* Default model card */}
      {data?.default && (
        <section className="card hero-card model-default-card">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="hero-kicker">DEFAULT MODEL</div>
              <h2 style={{ marginTop: 6 }}>
                <Star size={16} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--accent)' }} />
                {data.default.model}
              </h2>
              <div className="muted small" style={{ marginTop: 6 }}>
                provider · <span className="kbd">{data.default.provider}</span>
                {data.default.baseUrl && <> · base_url · <span className="kbd" style={{ wordBreak: 'break-all' }}>{data.default.baseUrl}</span></>}
              </div>
            </div>
            <span className="pill ok"><Sparkles size={12} /> currently active</span>
          </div>
        </section>
      )}

      {err && (
        <div className="card" style={{ borderColor: 'var(--danger,#ff6363)' }}>
          <div className="row start" style={{ gap: 8, color: 'var(--danger,#ff6363)' }}>
            <AlertCircle size={15} /> Load failed: {err}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div className="card" key={i}>
              <div className="skel" style={{ width: 180, height: 22 }} />
              <div style={{ height: 8 }} />
              <div className="skel" style={{ width: 240, height: 12 }} />
              <div style={{ height: 16 }} />
              <div className="skel" style={{ width: '100%', height: 60 }} />
            </div>
          ))}
        </div>
      )}

      {/* Providers list */}
      {!loading && data && data.providers.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}

      {/* Orphan models */}
      {!loading && data && data.orphanModels.length > 0 && (
        <section className="card">
          <div className="section-head">
            <div className="section-title">
              <span className="section-kicker">NO PROVIDER TAG</span>
              <h2>Orphan models from session history</h2>
            </div>
            <span className="pill"><Database size={12} /> {data.orphanModels.length}</span>
          </div>
          <div className="bar-list">
            {data.orphanModels.map((m) => (
              <ModelRow key={m.id} model={m} maxTokens={Math.max(...data.orphanModels.map((x) => x.tokens || 0), 1)} />
            ))}
          </div>
        </section>
      )}

      {!loading && data && data.providers.length === 0 && data.orphanModels.length === 0 && (
        <div className="empty-state" style={{ padding: 24 }}>
          <Cpu size={22} />
          <h2>No provider data</h2>
          <p className="muted small">
            Use <span className="kbd">hermes auth add</span> or <span className="kbd">hermes login</span> to add a provider credential.
          </p>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const totalTokens = provider.models.reduce((s, m) => s + (m.tokens || 0), 0);
  const totalSessions = provider.models.reduce((s, m) => s + (m.sessions || 0), 0);
  const maxTokens = Math.max(...provider.models.map((m) => m.tokens || 0), 1);

  return (
    <section className={`card provider-card ${provider.isDefault ? 'is-default' : ''}`}>
      <div className="section-head">
        <div className="section-title" style={{ minWidth: 0 }}>
          <span className="section-kicker">{provider.id}</span>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Server size={16} style={{ color: 'var(--accent)' }} />
            {provider.name}
            {provider.isDefault && <span className="pill ok"><Star size={10} /> default</span>}
          </h2>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {provider.credentialCount != null && (
            <span className="pill" title="Credentials from hermes auth list">
              <KeyRound size={11} /> {provider.credentialCount} creds
            </span>
          )}
          <span className="pill"><Cpu size={11} /> {provider.models.length} models</span>
        </div>
      </div>

      <div className="provider-stat-row">
        <div className="provider-stat">
          <div className="label">Sessions</div>
          <div className="value">{totalSessions.toLocaleString()}</div>
        </div>
        <div className="provider-stat">
          <div className="label">Tokens</div>
          <div className="value">{fmtTokens(totalTokens)}</div>
        </div>
        {provider.baseUrl && (
          <div className="provider-stat" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="label">base_url</div>
            <div className="value" style={{ fontSize: 11, fontFamily: 'var(--mono, monospace)', wordBreak: 'break-all', fontWeight: 500 }}>
              {provider.baseUrl}
            </div>
          </div>
        )}
      </div>

      <div className="bar-list" style={{ marginTop: 4 }}>
        {provider.models.map((m) => (
          <ModelRow key={m.id} model={m} maxTokens={maxTokens} />
        ))}
        {provider.models.length === 0 && (
          <div className="muted small" style={{ padding: '12px 4px' }}>No model usage recorded under this provider yet.</div>
        )}
      </div>
    </section>
  );
}

function ModelRow({ model, maxTokens }: { model: ModelInfo; maxTokens: number }) {
  const pct = maxTokens > 0 ? ((model.tokens || 0) / maxTokens) * 100 : 0;
  return (
    <div className="bar-row model-row">
      <span className="bar-label" style={{ minWidth: 0, flex: '1 1 220px' }}>
        <Cpu size={12} color={model.isDefault ? 'var(--accent)' : 'var(--muted)'} />
        <span style={{ fontWeight: model.isDefault ? 600 : 500, color: model.isDefault ? 'var(--accent)' : undefined }}>
          {model.id}
        </span>
        {model.isDefault && <Star size={10} style={{ color: 'var(--accent)' }} />}
      </span>
      <div className="bar-track" aria-label={`${model.id} ${fmtTokens(model.tokens)} tokens`}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="model-stats">
        <span className="model-stat" title="Total tokens">{fmtTokens(model.tokens)}</span>
        <span className="model-stat dim" title="Sessions that used this model">{model.sessions || 0} sessions</span>
        <span className="model-stat dim" title="Last used">{relTime(model.lastUsed)}</span>
      </div>
    </div>
  );
}
