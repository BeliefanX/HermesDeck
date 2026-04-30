'use client';
import { useEffect, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckProfile } from '@/lib/types';
import { Bot, Cpu, Network } from 'lucide-react';
import { Page, Card, Tag, Kbd, Kicker } from '@/components/Brand';

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    deckApi.profiles()
      .then((r) => setProfiles(r.profiles))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Page
      intro={
        <>
          A profile is HermesDeck&rsquo;s agent &amp; execution-context unit. Each one keeps its own state directory at{' '}
          <Kbd>~/.hermes/profiles/&lt;id&gt;</Kbd>.
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="skel" style={{ width: 140, height: 18 }} />
                <div style={{ height: 10 }} />
                <div className="skel" style={{ width: 220, height: 12 }} />
                <div style={{ height: 6 }} />
                <div className="skel" style={{ width: 180, height: 12 }} />
              </Card>
            ))
          : profiles.map((p) => (
              <Card key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: 'var(--surface-bg)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent)',
                    }}
                  >
                    <Bot size={16} />
                  </div>
                  {p.active && <Tag variant="green">active</Tag>}
                </div>

                <h2
                  style={{
                    margin: '12px 0 0',
                    fontSize: 18,
                    fontWeight: 620,
                    letterSpacing: '-.018em',
                    color: 'var(--strong-text)',
                  }}
                >
                  {p.name}
                </h2>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Cpu size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.model || 'model from Hermes config'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Network size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text)',
                        fontFamily: 'var(--font-mono)',
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.gateway || 'gateway —'}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid var(--hairline)',
                  }}
                >
                  <Kicker>PROFILE ID</Kicker>
                  <Kbd>{p.id}</Kbd>
                </div>
              </Card>
            ))}

        {!loading && profiles.length === 0 && (
          <Card style={{ gridColumn: '1 / -1', padding: 28, textAlign: 'center' }}>
            <Bot size={22} style={{ color: 'var(--muted)' }} />
            <h2
              style={{
                margin: '8px 0 4px',
                fontSize: 16,
                fontWeight: 620,
                color: 'var(--strong-text)',
              }}
            >
              No profiles found
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
              HermesDeck will run with a default context. Use <Kbd>hermes profile create</Kbd> to add a new execution context.
            </p>
          </Card>
        )}
      </div>
    </Page>
  );
}
