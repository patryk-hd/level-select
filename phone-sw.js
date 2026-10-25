// The Level Select phone app's service worker (npm run build -- --phone puts it at sw.js,
// with VERSION and FILES above this line). It makes the app work offline:
// - the app's own files are kept on the phone (one cache per version);
// - your library (library/copy.js stores your copy's files in the "copy" cache) is served in
//   place of the built-in sample, so every page shows your games;
// - covers you've seen are kept too, from their public image hosts.
/* global VERSION, FILES */
const APP = `level-select-app-${VERSION}`, COPY = 'level-select-copy', COVERS = 'level-select-covers';
const DATA = ['library/data/library-data.js', 'library/data/wishlist-data.js', 'library/data/connections.json', 'library/data/ratings.json'];
const COVER_HOSTS = ['images.igdb.com', 'raw.githubusercontent.com', 'thumbnails.libretro.com', 'shared.akamai.steamstatic.com', 'cdn.akamai.steamstatic.com', 'shared.cloudflare.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'images.gog.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP).then(cache => cache.addAll(FILES.map(file => new URL(file, self.registration.scope).href))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('level-select-app-') && key !== APP).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
    const file = url.href.slice(self.registration.scope.length).split(/[?#]/)[0] || 'index.html';
    event.respondWith((async () => {
      // Your copy, when you've opened one, comes first for your library's data.
      if (DATA.includes(file)) { const yours = await (await caches.open(COPY)).match(new URL(file, self.registration.scope).href); if (yours) return yours; }
      const kept = await caches.match(request, { ignoreSearch: true, cacheName: APP }) ?? await caches.match(new URL(file, self.registration.scope).href, { cacheName: APP });
      if (kept) return kept;
      try { return await fetch(request); }
      catch { return new Response('Offline, and this page isn’t on the phone yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    })());
    return;
  }
  // Covers: from the phone when seen before, refreshed in the background when online.
  if (COVER_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(COVERS), seen = await cache.match(request);
      const fresh = fetch(request).then(response => { if (response.ok || response.type === 'opaque') cache.put(request, response.clone()); return response; }).catch(() => null);
      return seen ?? await fresh ?? new Response('', { status: 504 });
    })());
  }
});
