'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function PWARegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Dev mode: kill any service worker left over from a previous prod visit.
    // Otherwise the stale SW intercepts /api/* requests and serves cached
    // 503 offline responses, making the whole console look "disconnected".
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        if (!regs.length) return;
        Promise.all(regs.map((r) => r.unregister())).then(() => {
          if (typeof caches !== 'undefined') {
            caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
          }
        });
      }).catch(() => {});
      return;
    }

    const onControllerChange = () => window.location.reload();

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        const watchInstalling = (worker?: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
              setDismissed(false);
            }
          });
        };
        watchInstalling(registration.installing);
        registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
        if (registration.waiting) {
          setUpdateReady(true);
        }
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div className="pwa-update" role="status" aria-live="polite">
      <button
        type="button"
        className="pwa-update-action"
        onClick={() =>
          navigator.serviceWorker
            .getRegistration()
            .then((r) => r?.waiting?.postMessage({ type: 'SKIP_WAITING' }))
        }
        aria-label="应用有新版本，点击立即更新"
      >
        <span className="pwa-update-dot" aria-hidden />
        <span>新版本已就绪 · 点击更新</span>
      </button>
      <button
        type="button"
        className="pwa-update-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="稍后再说"
        title="稍后再说"
      >
        <X size={14} />
      </button>
    </div>
  );
}
