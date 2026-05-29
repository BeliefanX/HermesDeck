const CACHE_VERSION = 'hermesdeck-pwa-v10';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// LRU caps. Without these the IMAGE_CACHE grows unbounded as users scroll
// history; RUNTIME_CACHE accumulates every visited page. On a long-lived PWA
// install that fills tens of MB and triggers eviction warnings on iOS.
const IMAGE_CACHE_MAX = 60;
const RUNTIME_CACHE_MAX = 40;

// App shell — kept tight to the routes that actually exist.
// /chat?source=pwa is the manifest start_url; cache the bare /chat too so
// runtime upgrades to the query-string variant work even when offline.
// Dynamic routes (/runs/[id]) can't be pre-cached; they fall back to /offline
// when navigation fails AND the runtime cache has nothing.
const APP_SHELL = ['/', '/chat', '/chat?source=pwa', '/profiles', '/runs', '/tools', '/terminal', '/settings', '/offline', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Cache entries individually so a single 404 doesn't fail the install.
      // Surface failures to the worker console — silent .catch() hid the case
      // where a typo'd shell URL never got cached.
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch((err) => {
        console.warn('[sw] shell cache miss:', url, err && err.message);
      })))
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

  // Hermes-cached binary artifacts (images, audio, etc.) are served via
  // /api/deck/cache-image. They're effectively immutable — the upstream path
  // is the cache key — so we use stale-while-revalidate. This keeps images
  // available offline (e.g. scrolling back through history) instead of
  // breaking when the JSON offline fallback would otherwise replace binary.
  if (url.pathname === '/api/deck/cache-image') {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const fetched = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            putWithTrim(IMAGE_CACHE, req, copy, IMAGE_CACHE_MAX);
          }
          return res;
        }).catch(() => hit || new Response('', { status: 504 }));
        return hit || fetched;
      })
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

  // Navigations: network-first, fall back to cached page → /offline.
  // Dynamic routes (/runs/[id]) won't have a cache entry on first offline
  // visit; the /offline shell is a soft landing in that case.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          putWithTrim(RUNTIME_CACHE, req, copy, RUNTIME_CACHE_MAX);
        }
        return res;
      }).catch(() =>
        caches.match(req).then(async (hit) => {
          if (hit) return hit;
          if (url.pathname === '/chat') {
            const chatHit = await caches.match('/chat?source=pwa') || await caches.match('/chat');
            if (chatHit) return chatHit;
          }
          return caches.match('/offline').then((off) => off || Response.error());
        })
      )
    );
    return;
  }

  // Static assets: cache-while-fetching for style/script/image/font.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && ['style', 'script', 'image', 'font'].includes(req.destination)) {
        const copy = res.clone();
        putWithTrim(RUNTIME_CACHE, req, copy, RUNTIME_CACHE_MAX);
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
