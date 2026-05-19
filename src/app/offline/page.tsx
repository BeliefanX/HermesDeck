'use client';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Page, Card, Kicker, Btn } from '@/components/Brand';
import { useT } from '@/lib/i18n';

export default function OfflinePage() {
  const t = useT({
    zh: {
      kicker: 'HERMESDECK PWA',
      title: '当前已离线',
      desc: '应用外壳已被缓存，之前加载过的页面仍可阅读。聊天、终端及 Hermes API 操作需要您回到同一网络后才能使用。',
      hint: '请确认本设备与 HermesDeck 主机处于同一网络。',
      retry: '重新连接',
    },
    en: {
      kicker: 'HERMESDECK PWA',
      title: "You're offline",
      desc: 'The app shell is cached and previously loaded pages stay readable. Chat, terminal and Hermes API operations need you back on the same network.',
      hint: 'Make sure this device is on the same network as the HermesDeck host.',
      retry: 'Retry connection',
    },
  });

  return (
    <Page>
      <Card hero>
        <Kicker>{t.kicker}</Kicker>
        <h1
          style={{
            margin: '6px 0 10px',
            fontSize: 28,
            fontWeight: 650,
            letterSpacing: '-.03em',
            color: 'var(--strong-text)',
          }}
        >
          {t.title}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
          {t.desc}
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
            {t.hint}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn variant="primary" icon={<RefreshCw size={14} />} onClick={() => location.reload()}>
            {t.retry}
          </Btn>
        </div>
      </Card>
    </Page>
  );
}
