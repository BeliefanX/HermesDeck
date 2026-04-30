'use client';
import { useEffect, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckHealth } from '@/lib/types';
import { Sun, Moon, Monitor, Trash2, ShieldCheck, Server, Database, RefreshCw } from 'lucide-react';
import { Page, Card, SectionHead, Chip, Btn, Tag, Kicker, Kbd, ListRow } from '@/components/Brand';

type Theme = 'dark' | 'light';

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [health, setHealth] = useState<DeckHealth | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number>(0);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || 'dark');
    refreshHealth();
    measureStorage();
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hermesdeck-theme', next); } catch {}
  }

  function applySystemTheme() {
    try { localStorage.removeItem('hermesdeck-theme'); } catch {}
    const sys: Theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(sys);
    document.documentElement.dataset.theme = sys;
  }

  async function refreshHealth() {
    setRefreshing(true);
    try { setHealth(await deckApi.health()); } catch {} finally { setRefreshing(false); }
  }

  function measureStorage() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!k) continue;
        const v = localStorage.getItem(k) || '';
        total += k.length + v.length;
      }
      setStorageUsed(total);
    } catch {}
  }

  function clearChatStorage() {
    if (!confirm('Clear HermesDeck local drafts, session index and theme preference? This cannot be undone.')) return;
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('hermesdeck')).forEach((k) => localStorage.removeItem(k));
      setCleared(true);
      measureStorage();
      setTimeout(() => setCleared(false), 2400);
    } catch {}
  }

  return (
    <Page intro="Basics: theme, connection info, local cache. Sensitive config is not exposed in the frontend; future versions will edit it via a guarded BFF.">
      <Card>
        <SectionHead kicker="APPEARANCE" title="Theme" />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          Theme persists in the browser and is replayed by the SSR bootstrap script to avoid flashes.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={theme === 'dark'} onClick={() => applyTheme('dark')} icon={<Moon size={11} />}>Dark</Chip>
          <Chip active={theme === 'light'} onClick={() => applyTheme('light')} icon={<Sun size={11} />}>Light</Chip>
          <Chip onClick={applySystemTheme} icon={<Monitor size={11} />}>Follow system</Chip>
        </div>
      </Card>

      <Card>
        <SectionHead
          kicker="BACKEND"
          title="Hermes connections"
          right={
            <Btn size="sm" icon={<RefreshCw size={12} className={refreshing ? 'spin' : ''} />} onClick={refreshHealth} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Btn>
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <ListRow
            first
            icon={<Server size={14} />}
            title="Hermes API Server"
            sub={health?.apiServer.baseUrl || '—'}
            right={<Tag variant={health?.apiServer.healthy ? 'green' : 'yellow'}>{health?.apiServer.healthy ? 'Healthy' : 'Fallback'}</Tag>}
          />
          <ListRow
            icon={<Database size={14} />}
            title="Hermes Dashboard"
            sub={health?.dashboard.baseUrl || '—'}
            right={<Tag variant={health?.dashboard.healthy ? 'green' : 'yellow'}>{health?.dashboard.healthy ? 'Seen' : 'Sidecar'}</Tag>}
          />
        </div>
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--surface-bg)',
            border: '1px solid var(--line)',
            borderRadius: 8,
          }}
        >
          <Kicker style={{ marginBottom: 8 }}>ENV VARS · SECRETS REDACTED</Kicker>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text)' }}>
            <div>API server: <Kbd>HERMES_API_BASE</Kbd></div>
            <div>Dashboard: <Kbd>HERMES_DASHBOARD_BASE</Kbd></div>
            <div>Auth: <Kbd>HERMES_API_KEY</Kbd> · <Kbd>API_SERVER_KEY</Kbd></div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHead kicker="LOCAL CACHE" title="Browser-stored state" />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: 620 }}>
          HermesDeck keeps drafts, the session index and response_id chains in the browser, so offline browsing and
          multi-profile switching feel snappy.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Tag icon={<ShieldCheck size={11} />}>on-device only</Tag>
          <Tag>~ {(storageUsed / 1024).toFixed(1)} KB</Tag>
          <Btn variant="danger" icon={<Trash2 size={13} />} onClick={clearChatStorage}>
            Clear HermesDeck cache
          </Btn>
          {cleared && <Tag variant="green">Cleared</Tag>}
        </div>
      </Card>
    </Page>
  );
}
