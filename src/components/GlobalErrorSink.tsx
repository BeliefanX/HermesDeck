'use client';

import { useEffect } from 'react';

// Browser-side unhandledrejection sink.
//
// Many of our useEffect cleanups call `ac.abort()` to cancel an in-flight
// fetch. The fetch site already has a `.catch(() => {})` handler, but in
// React 19 strict-mode + Next.js 16 dev mode the AbortError occasionally
// escapes the chain (specifically when the cleanup fires inside the second
// strict-mode pass and the resulting rejection is delivered after Next.js's
// dev overlay has installed its own `unhandledrejection` listener).
//
// The result is a dev-only red error overlay every time the user navigates
// between pages — which makes the app *feel* deeply broken even though the
// rejection is harmless. We swallow AbortError / TimeoutError specifically;
// real errors still surface so we don't paper over actual bugs.
export function GlobalErrorSink() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const r = event.reason as { name?: string; code?: string; message?: string } | null;
      if (!r) return;
      const name = typeof r.name === 'string' ? r.name : '';
      const code = typeof r.code === 'string' ? r.code : '';
      const msg = typeof r.message === 'string' ? r.message : '';
      const benign =
        name === 'AbortError' ||
        name === 'TimeoutError' ||
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        /signal is aborted/i.test(msg) ||
        /aborted without reason/i.test(msg);
      if (benign) {
        // Stop Next.js's dev overlay from rendering this. We still log a
        // `debug` line so a curious developer can confirm something was
        // swallowed without flooding the console.
        event.preventDefault();
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[hermesdeck] benign rejection swallowed:', name || msg);
        }
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);
  return null;
}
