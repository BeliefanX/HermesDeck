'use client';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Page, Card, Kicker, Btn } from '@/components/Brand';

export default function OfflinePage() {
  return (
    <Page>
      <Card hero>
        <Kicker>HERMESDECK PWA</Kicker>
        <h1
          style={{
            margin: '6px 0 10px',
            fontSize: 28,
            fontWeight: 650,
            letterSpacing: '-.03em',
            color: 'var(--strong-text)',
          }}
        >
          You&rsquo;re offline
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
          The app shell is cached and previously loaded pages stay readable. Chat, terminal and Hermes API operations need
          you back on the same network.
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 12,
            marginTop: 18,
            background: 'var(--surface-bg)',
            border: '1px solid var(--line)',
            borderRadius: 8,
          }}
        >
          <WifiOff size={16} style={{ color: 'var(--muted)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
            Make sure this device is on the same network as the HermesDeck host.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn variant="primary" icon={<RefreshCw size={14} />} onClick={() => location.reload()}>
            Retry connection
          </Btn>
        </div>
      </Card>
    </Page>
  );
}
