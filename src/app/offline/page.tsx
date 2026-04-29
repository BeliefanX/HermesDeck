'use client';
import { WifiOff, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="page grid">
      <section className="card hero-card offline-card">
        <div className="hero-kicker">HermesDeck PWA</div>
        <h1>当前离线</h1>
        <p className="muted" style={{ marginTop: 10, maxWidth: 560 }}>
          应用外壳已缓存，可以继续浏览已加载的页面；聊天、终端和 Hermes API 操作需要回到同一局域网并恢复连接。
        </p>
        <div className="surface row" style={{ justifyContent: 'flex-start', marginTop: 18, gap: 10 }}>
          <WifiOff size={18} />
          <span className="small">请确认手机仍连接到 HermesDeck 所在网络。</span>
        </div>
        <div className="row start" style={{ marginTop: 14, gap: 10 }}>
          <button className="btn primary" onClick={() => location.reload()}>
            <RefreshCw size={15} /> 重试连接
          </button>
        </div>
      </section>
    </div>
  );
}
