'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const DISMISSED_SW_VERSION_KEY = 'hermesdeck.pwa.dismissedSwVersion';

function getDismissedVersion() {
  try {
    return window.localStorage.getItem(DISMISSED_SW_VERSION_KEY);
  } catch {
    return null;
  }
}

function setDismissedVersion(version: string) {
  try {
    window.localStorage.setItem(DISMISSED_SW_VERSION_KEY, version);
  } catch {}
}

function getWorkerVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(null), 1000);
    channel.port1.onmessage = (event: MessageEvent<{ type?: string; version?: string }>) => {
      window.clearTimeout(timeout);
      resolve(event.data?.type === 'VERSION' && event.data.version ? event.data.version : null);
    };
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      window.clearTimeout(timeout);
      resolve(null);
    }
  });
}

export function PWARegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const pendingWorker = useRef<ServiceWorker | null>(null);
  // Only reload when the user clicks the update banner. The default
  // controllerchange behavior would auto-reload on every SW activation, which
  // can wipe a half-typed message or interrupt a streaming response.
  const userInitiatedUpdate = useRef(false);

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

    const onControllerChange = () => {
      if (!userInitiatedUpdate.current) return;
      window.location.reload();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        const showUpdateForWorker = (worker: ServiceWorker) => {
          getWorkerVersion(worker).then((version) => {
            // A statechange/updatefound callback can race activation. Only show
            // the prompt while this exact worker is still the registration's
            // waiting worker; otherwise a stale async VERSION reply can leave
            // the banner visible after the update has already been consumed.
            if (registration.waiting !== worker || worker.state !== 'installed') return;
            if (version && getDismissedVersion() === version) return;
            pendingWorker.current = worker;
            setPendingVersion(version);
            setUpdateReady(true);
            setDismissed(false);
          }).catch(() => {
            if (registration.waiting !== worker || worker.state !== 'installed') return;
            pendingWorker.current = worker;
            setPendingVersion(null);
            setUpdateReady(true);
            setDismissed(false);
          });
        };
        const watchInstalling = (worker?: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateForWorker(worker);
            } else if (pendingWorker.current === worker && worker.state !== 'installed') {
              pendingWorker.current = null;
              setUpdateReady(false);
              setDismissed(false);
              setPendingVersion(null);
            }
          });
        };
        watchInstalling(registration.installing);
        registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
        if (registration.waiting) {
          showUpdateForWorker(registration.waiting);
        }
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!updateReady || dismissed) return null;

  const applyUpdate = () => {
    userInitiatedUpdate.current = true;
    navigator.serviceWorker
      .getRegistration()
      .then((r) => {
        const waiting = r?.waiting;
        if (!waiting) {
          // Nothing waiting — drop the flag so a future background activation
          // doesn't trigger an unwanted auto-reload after the user dismissed
          // an earlier banner.
          userInitiatedUpdate.current = false;
          setUpdateReady(false);
          return;
        }
        waiting.postMessage({ type: 'SKIP_WAITING' });
        setUpdateReady(false);
      })
      .catch(() => { userInitiatedUpdate.current = false; });
  };

  return (
    <div className="pwa-update" role="status" aria-live="polite">
      <button
        type="button"
        className="pwa-update-action"
        onClick={applyUpdate}
        aria-label="A new version is ready — click to update"
      >
        <span className="pwa-update-dot" aria-hidden />
        <span>New version ready · click to update</span>
      </button>
      <button
        type="button"
        className="pwa-update-dismiss"
        onClick={() => {
          if (pendingVersion) setDismissedVersion(pendingVersion);
          setDismissed(true);
        }}
        aria-label="Dismiss for now"
        title="Dismiss for now"
      >
        <X size={14} />
      </button>
    </div>
  );
}
