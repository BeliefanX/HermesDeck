'use client';
import { WifiOff, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="page grid">
      <section className="card hero-card offline-card">
        <div className="hero-kicker">HERMESDECK PWA</div>
        <h1>You&rsquo;re offline</h1>
        <p className="muted" style={{ marginTop: 10, maxWidth: 560 }}>
          The app shell is cached and previously loaded pages stay readable.
          Chat, terminal and Hermes API operations need you back on the same network.
        </p>
        <div className="surface row" style={{ justifyContent: 'flex-start', marginTop: 18, gap: 10 }}>
          <WifiOff size={18} />
          <span className="small">Make sure this device is on the same network as the HermesDeck host.</span>
        </div>
        <div className="row start" style={{ marginTop: 14, gap: 10 }}>
          <button className="btn primary" onClick={() => location.reload()}>
            <RefreshCw size={15} /> Retry connection
          </button>
        </div>
      </section>
    </div>
  );
}
