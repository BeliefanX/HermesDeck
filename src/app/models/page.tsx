'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckModelsResponse, ModelInfo, ProviderInfo } from '@/lib/types';
import { Cpu, Server, Star, Database, Plug, KeyRound, AlertCircle, Sparkles } from 'lucide-react';
import { Page, Card, Kicker, Tag, Kbd, MetricCard, SectionHead } from '@/components/Brand';

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
    <Page
      intro={
        <>
          Currently connected providers and their previously used models. Data sourced from{' '}
          <Kbd>hermes auth list</Kbd>, <Kbd>~/.hermes/config.yaml</Kbd> and the sessions table in state.db.
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <MetricCard
          kicker="PROVIDERS"
          value={loading ? '—' : totals.providers}
          sub={loading ? 'Loading…' : `${totals.withCreds} with credentials`}
        />
        <MetricCard
          kicker="MODELS"
          value={loading ? '—' : totals.models}
          sub="used or set as default"
        />
        <MetricCard
          kicker="TOKENS · ALL TIME"
          value={loading ? '—' : fmtTokens(totals.tokens)}
          sub="across providers × models"
        />
      </div>

      {data?.default && (
        <Card hero>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Kicker>DEFAULT MODEL</Kicker>
              <h2
                style={{
                  margin: '6px 0 6px',
                  fontSize: 20,
                  fontWeight: 650,
                  letterSpacing: '-.018em',
                  color: 'var(--strong-text)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Star size={16} style={{ color: 'var(--accent)' }} />
                {data.default.model}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>provider · <Kbd>{data.default.provider}</Kbd></span>
                {data.default.baseUrl && <span>base_url · <Kbd>{data.default.baseUrl}</Kbd></span>}
              </div>
            </div>
            <Tag variant="green" icon={<Sparkles size={11} />}>currently active</Tag>
          </div>
        </Card>
      )}

      {err && (
        <Card style={{ borderColor: 'rgba(239,68,68,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
            <AlertCircle size={15} /> Load failed: {err}
          </div>
        </Card>
      )}

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <div className="skel" style={{ width: 180, height: 22 }} />
              <div style={{ height: 8 }} />
              <div className="skel" style={{ width: 240, height: 12 }} />
              <div style={{ height: 16 }} />
              <div className="skel" style={{ width: '100%', height: 60 }} />
            </Card>
          ))}
        </div>
      )}

      {!loading && data && data.providers.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}

      {!loading && data && data.orphanModels.length > 0 && (
        <Card>
          <SectionHead
            kicker="NO PROVIDER TAG"
            title="Orphan models from session history"
            right={<Tag icon={<Database size={11} />}>{data.orphanModels.length}</Tag>}
          />
          <div>
            {data.orphanModels.map((m, i) => (
              <ModelRow
                key={m.id}
                model={m}
                maxTokens={Math.max(...data.orphanModels.map((x) => x.tokens || 0), 1)}
                first={i === 0}
              />
            ))}
          </div>
        </Card>
      )}

      {!loading && data && data.providers.length === 0 && data.orphanModels.length === 0 && (
        <Card style={{ textAlign: 'center', padding: 28 }}>
          <Cpu size={22} style={{ color: 'var(--muted)' }} />
          <h2 style={{ margin: '8px 0 4px', fontSize: 16, fontWeight: 620, color: 'var(--strong-text)' }}>No provider data</h2>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
            Use <Kbd>hermes auth add</Kbd> or <Kbd>hermes login</Kbd> to add a provider credential.
          </p>
        </Card>
      )}
    </Page>
  );
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const totalTokens = provider.models.reduce((s, m) => s + (m.tokens || 0), 0);
  const totalSessions = provider.models.reduce((s, m) => s + (m.sessions || 0), 0);
  const maxTokens = Math.max(...provider.models.map((m) => m.tokens || 0), 1);

  return (
    <Card>
      <SectionHead
        kicker={provider.id}
        title={
          <>
            <Server size={15} style={{ color: 'var(--accent)' }} />
            <span>{provider.name}</span>
            {provider.isDefault && <Tag variant="green" icon={<Star size={10} />}>default</Tag>}
          </>
        }
        right={
          <>
            {provider.credentialCount != null && (
              <Tag icon={<KeyRound size={11} />}>{provider.credentialCount} creds</Tag>
            )}
            <Tag icon={<Cpu size={11} />}>{provider.models.length} models</Tag>
          </>
        }
      />

      <div
        style={{
          display: 'flex',
          gap: 24,
          padding: '10px 0',
          borderTop: '1px solid var(--hairline)',
          borderBottom: '1px solid var(--hairline)',
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Kicker>SESSIONS</Kicker>
          <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {totalSessions.toLocaleString()}
          </div>
        </div>
        <div>
          <Kicker>TOKENS</Kicker>
          <div style={{ fontSize: 16, fontWeight: 620, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtTokens(totalTokens)}
          </div>
        </div>
        {provider.baseUrl && (
          <div style={{ flex: 1, minWidth: 180 }}>
            <Kicker>BASE_URL</Kicker>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--value-text)', wordBreak: 'break-all', marginTop: 4 }}>
              {provider.baseUrl}
            </div>
          </div>
        )}
      </div>

      <div>
        {provider.models.map((m, i) => (
          <ModelRow key={m.id} model={m} maxTokens={maxTokens} first={i === 0} />
        ))}
        {provider.models.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 4px' }}>
            No model usage recorded under this provider yet.
          </div>
        )}
      </div>
    </Card>
  );
}

function ModelRow({ model, maxTokens, first }: { model: ModelInfo; maxTokens: number; first?: boolean }) {
  const pct = maxTokens > 0 ? ((model.tokens || 0) / maxTokens) * 100 : 0;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 2fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '8px 0',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Cpu size={12} style={{ color: model.isDefault ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: model.isDefault ? 600 : 500,
            color: model.isDefault ? 'var(--accent)' : 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {model.id}
        </span>
        {model.isDefault && <Star size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
      </div>
      <div style={{ height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          justifyContent: 'flex-end',
        }}
      >
        <span style={{ color: 'var(--value-text)' }}>{fmtTokens(model.tokens)}</span>
        <span style={{ color: 'var(--muted-2)' }}>{model.sessions || 0} sessions</span>
        <span style={{ color: 'var(--muted-2)' }}>{relTime(model.lastUsed)}</span>
      </div>
    </div>
  );
}
