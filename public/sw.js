const CACHE_VERSION = 'hermesdeck-pwa-v5';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// App shell — kept tight to the routes that actually exist.
// /chat?source=pwa is the manifest start_url; cache the bare /chat too so
// runtime upgrades to the query-string variant work even when offline.
const APP_SHELL = ['/', '/chat', '/profiles', '/runs', '/tools', '/terminal', '/settings', '/offline', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Cache entries individually so a single 404 doesn't fail the install.
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: network-only, with a structured offline JSON so the UI can render
  // an offline state instead of crashing on a non-OK response.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ ok: false, offline: true, error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Navigations: network-first, fall back to cached page → /offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req).then((hit) => hit || caches.match('/offline').then((off) => off || Response.error()))
      )
    );
    return;
  }

  // Static assets: cache-while-fetching for style/script/image/font.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && ['style', 'script', 'image', 'font'].includes(req.destination)) {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
