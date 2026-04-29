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
    if (!confirm('清空 HermesDeck 的本地草稿、会话索引与主题偏好？此操作不可撤销。')) return;
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('hermesdeck')).forEach((k) => localStorage.removeItem(k));
      setCleared(true);
      measureStorage();
      setTimeout(() => setCleared(false), 2400);
    } catch {}
  }

  return (
    <div className="page grid">
      <p className="page-intro">基础设置：主题、连接信息、本地缓存。敏感配置不在前端直接展示，未来会通过受保护的 BFF 编辑。</p>

      <section className="card">
        <h2>外观</h2>
        <p className="muted small" style={{ marginTop: 6 }}>主题会保存在浏览器，并在加载时同步到服务端渲染前置脚本，避免闪烁。</p>
        <div className="row start" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className={`chip ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => applyTheme('dark')}
          >
            <Moon size={13} /> 深色
          </button>
          <button
            className={`chip ${theme === 'light' ? 'active' : ''}`}
            onClick={() => applyTheme('light')}
          >
            <Sun size={13} /> 浅色
          </button>
          <button className="chip" onClick={applySystemTheme}>
            <MonitorSmartphone size={13} /> 跟随系统
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2>后端</h2>
          <button className="btn sm" onClick={refreshHealth} disabled={refreshing} aria-label="刷新健康检查">
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> 刷新
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
          <div className="tiny" style={{ marginBottom: 6 }}>环境变量（敏感值不展示）</div>
          <div className="small" style={{ display: 'grid', gap: 4 }}>
            <div>API Server: <span className="kbd">HERMES_API_BASE</span></div>
            <div>Dashboard: <span className="kbd">HERMES_DASHBOARD_BASE</span></div>
            <div>Auth: <span className="kbd">HERMES_API_KEY</span> · <span className="kbd">API_SERVER_KEY</span></div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>本地缓存</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          HermesDeck 把本地草稿、会话索引和 response_id 串联存在浏览器，便于离线浏览和多 profile 切换。
        </p>
        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <span className="pill"><ShieldCheck size={13} /> 仅本机存储</span>
          <span className="pill">~ {(storageUsed / 1024).toFixed(1)} KB</span>
          <button className="btn danger" onClick={clearChatStorage}>
            <Trash2 size={14} /> 清空 HermesDeck 缓存
          </button>
          {cleared && <span className="pill ok">已清空</span>}
        </div>
      </section>
    </div>
  );
}
