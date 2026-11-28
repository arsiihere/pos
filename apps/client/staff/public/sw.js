// ⚠️ 00 HPA v1.15 §8.2 (SW-1); 02b v1.0.32 QO-2 (owner ruling R3-1 of 2026-11-28 QA-R3, BUG-3): the /staff/ service
// worker of the cashier kiosk (README R15: Chrome / Edge launched with --unsafely-treat-insecure-origin-as-secure).
// The page registers it on a paired cashier_kiosk only; every other device has none.
//
// - The hub fills PRECACHE when it loads the build: { build: <sha256 of index.html>, files: [assets…] }. A new build
//   is a new worker file: the browser installs it, it caches that build, and on activate every older cache is deleted.
// - Install: the index (checked to be this build: its pos-staff-build meta) and every build file into one cache,
//   "pos-staff-<build>". A hub that changed build in between fails the install; the browser tries again later.
// - Navigation to /staff/: the network first, always (online, a deploy is never served stale). No answer (the hub is
//   down or unreachable, or 8 s without one) → the cached index of this worker's build, marked
//   <meta name="pos-offline-boot" content="1">: the page shows "Can't reach the hub" and reloads once the hub answers.
// - A build file (/staff/assets/…): the cache first (the names are content-hashed), else the network.
// - Everything else (the API, /health, the socket, other pages): not touched, never cached.
/* eslint-disable */
const PRECACHE = /*POS_PRECACHE*/ null;
const PREFIX = 'pos-staff-';
const NAV_TIMEOUT_MS = 8000;
const SCOPE = new URL('./', self.registration.scope).pathname;
const CACHE = PRECACHE === null ? null : PREFIX + PRECACHE.build;
const FILES = new Set(PRECACHE === null ? [] : PRECACHE.files.map((f) => SCOPE + f));

self.addEventListener('install', (event) => {
  if (CACHE === null) return;
  event.waitUntil(
    (async () => {
      const res = await fetch(SCOPE, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('index ' + res.status);
      const html = await res.text();
      const m = /<meta name="pos-staff-build" content="([0-9a-f]+)">/.exec(html);
      if (m === null || m[1] !== PRECACHE.build) throw new Error('the hub changed build');
      const cache = await caches.open(CACHE);
      await cache.addAll([...FILES].map((url) => new Request(url, { cache: 'no-store' })));
      await cache.put(SCOPE, new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

function offlineIndex() {
  return caches
    .open(CACHE)
    .then((cache) => cache.match(SCOPE))
    .then(async (cached) => {
      if (cached === undefined) return Response.error();
      const html = (await cached.text()).replace('</head>', '<meta name="pos-offline-boot" content="1"></head>');
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
}

function network(request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), NAV_TIMEOUT_MS);
  return fetch(request, { signal: abort.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (CACHE === null || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html')) {
    event.respondWith(network(request).catch(() => offlineIndex()));
    return;
  }
  if (FILES.has(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
  }
});
