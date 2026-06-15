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
      <div className="offline-page">
        <div className="offline-card offline-card-pwa">
          <Card hero>
            <Kicker>{t.kicker}</Kicker>
            <h1 className="offline-title">
              {t.title}
            </h1>
            <p className="offline-desc">
              {t.desc}
            </p>
            <div className="offline-hint">
              <WifiOff size={16} />
              <span>
                {t.hint}
              </span>
            </div>
            <div className="offline-actions">
              <Btn variant="primary" icon={<RefreshCw size={14} />} onClick={() => location.reload()}>
                {t.retry}
              </Btn>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
