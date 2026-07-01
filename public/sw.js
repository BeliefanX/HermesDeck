const CACHE_VERSION = 'hermesdeck-pwa-v50';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// LRU cap. Without this RUNTIME_CACHE accumulates every visited page. On a
// long-lived PWA install that fills tens of MB and triggers eviction warnings
// on iOS.
const RUNTIME_CACHE_MAX = 40;

// App shell — only public/offline-safe assets. Authenticated navigation routes
// (/, /chat, /profiles, /runs, /cron, /tools, /terminal, /config, /kanban,
// /lcm, /settings) must never be precached or served as stale HTML across
// users. Failed navigations land on /offline instead.
const APP_SHELL = ['/offline', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Cache entries individually so a single 404 doesn't fail the install.
      // Surface failures to the worker console — silent .catch() hid the case
      // where a typo'd shell URL never got cached.
      Promise.all(APP_SHELL.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok && !res.redirected) await cache.put(url, res);
        } catch (err) {
          console.warn('[sw] shell cache miss:', url, err && err.message);
        }
      }))
    )
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
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});

function safeNotificationUrl(rawUrl) {
  try {
    const url = new URL(typeof rawUrl === 'string' && rawUrl ? rawUrl : '/', self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    if (url.pathname.startsWith('/api/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim().slice(0, 120)
    : 'HermesDeck';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 240) : '';
  const url = safeNotificationUrl(payload.url);
  const tag = typeof payload.tag === 'string' && payload.tag.trim() ? payload.tag.trim().slice(0, 128) : 'hermesdeck-notification';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url },
    icon: '/icons/icon-192.png',
    badge: '/icons/maskable-512.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification?.data?.url);
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          if ('navigate' in client) await client.navigate(url);
          return client.focus();
        }
      } catch {}
    }
    return self.clients.openWindow(url);
  })());
});

// LRU trim: oldest-inserted-first eviction. The Cache API has no natural
// ordering hint; we use insertion order from `cache.keys()`, which Chrome /
// Safari both preserve in practice.
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const toDrop = keys.length - maxEntries;
    for (let i = 0; i < toDrop; i++) {
      await cache.delete(keys[i]);
    }
  } catch {}
}

async function putWithTrim(cacheName, req, res, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res);
    await trimCache(cacheName, maxEntries);
  } catch {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // /api/deck/cache-image is admin-only; never satisfy it from a Service Worker
  // cache because a later ordinary session could otherwise receive a previously
  // cached admin artifact by URL. Delete any legacy per-request hit before
  // falling through to the authenticated network request.
  if (url.pathname === '/api/deck/cache-image') {
    event.respondWith(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.open(key).then((cache) => cache.delete(req)))))
        .then(() => fetch(req))
        .catch(() => new Response(
          JSON.stringify({ ok: false, offline: true, error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Other API requests: network-pass-through. Synthesize the structured
  // offline body ONLY when the fetch THROWS (i.e. the network is genuinely
  // unreachable). A real upstream 5xx must be surfaced as-is — collapsing it
  // to "offline" hides server outages and confuses the UI's reconnect logic.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ ok: false, offline: true, error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Navigations: network-first, but never runtime-cache authenticated HTML.
  // When offline, return the public offline page only.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline').then((off) => off || Response.error()))
    );
    return;
  }

  // Static assets: cache-while-fetching for style/script/image/font.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && !res.redirected && ['style', 'script', 'image', 'font'].includes(req.destination)) {
        const copy = res.clone();
        putWithTrim(RUNTIME_CACHE, req, copy, RUNTIME_CACHE_MAX);
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
