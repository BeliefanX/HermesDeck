'use client';
import { useEffect, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckHealth } from '@/lib/types';
import { Sun, Moon, MonitorSmartphone, Trash2, ShieldCheck, Server, Database, RefreshCw } from 'lucide-react';

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
    <div className="page grid">
      <p className="page-intro">
        Basics: theme, connection info, local cache. Sensitive config is not exposed in the frontend;
        future versions will edit it via a guarded BFF.
      </p>

      <section className="card">
        <h2>Appearance</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          Theme persists in the browser and is replayed by the SSR bootstrap script to avoid flashes.
        </p>
        <div className="row start" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className={`chip ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => applyTheme('dark')}
          >
            <Moon size={13} /> Dark
          </button>
          <button
            className={`chip ${theme === 'light' ? 'active' : ''}`}
            onClick={() => applyTheme('light')}
          >
            <Sun size={13} /> Light
          </button>
          <button className="chip" onClick={applySystemTheme}>
            <MonitorSmartphone size={13} /> Follow system
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2>Backend</h2>
          <button className="btn sm" onClick={refreshHealth} disabled={refreshing} aria-label="Refresh health">
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        </div>
        <div className="list" style={{ marginTop: 12 }}>
          <div className="list-row">
            <div className="meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}><Server size={15} /></span>
              <div style={{ minWidth: 0 }}>
                <b>Hermes API Server</b>
                <div className="muted small">{health?.apiServer.baseUrl || '—'}</div>
              </div>
            </div>
            <span className={`pill ${health?.apiServer.healthy ? 'ok' : 'warn'}`}>
              {health?.apiServer.healthy ? 'Healthy' : 'Fallback'}
            </span>
          </div>
          <div className="list-row">
            <div className="meta" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}><Database size={15} /></span>
              <div style={{ minWidth: 0 }}>
                <b>Hermes Dashboard</b>
                <div className="muted small">{health?.dashboard.baseUrl || '—'}</div>
              </div>
            </div>
            <span className={`pill ${health?.dashboard.healthy ? 'ok' : 'warn'}`}>
              {health?.dashboard.healthy ? 'Seen' : 'Sidecar'}
            </span>
          </div>
        </div>
        <div className="surface" style={{ marginTop: 12 }}>
          <div className="tiny" style={{ marginBottom: 6 }}>ENV VARS · SECRETS REDACTED</div>
          <div className="small" style={{ display: 'grid', gap: 4 }}>
            <div>API server: <span className="kbd">HERMES_API_BASE</span></div>
            <div>Dashboard: <span className="kbd">HERMES_DASHBOARD_BASE</span></div>
            <div>Auth: <span className="kbd">HERMES_API_KEY</span> · <span className="kbd">API_SERVER_KEY</span></div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Local cache</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          HermesDeck keeps drafts, the session index and response_id chains in the browser,
          so offline browsing and multi-profile switching feel snappy.
        </p>
        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <span className="pill"><ShieldCheck size={13} /> on-device only</span>
          <span className="pill">~ {(storageUsed / 1024).toFixed(1)} KB</span>
          <button className="btn danger" onClick={clearChatStorage}>
            <Trash2 size={14} /> Clear HermesDeck cache
          </button>
          {cleared && <span className="pill ok">Cleared</span>}
        </div>
      </section>
    </div>
  );
}
