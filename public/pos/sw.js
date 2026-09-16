// Service Worker for POS App - offline support
const CACHE_NAME = 'pos-cache-v1';
const OFFLINE_URL = '/pos/';

// Pre-cache critical assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/pos/',
        '/pos/manifest.json'
      ]);
    }).then(() => self.skipWaiting())
  );
});

// Network-first strategy for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Don't cache Socket.io or API writes
  if (url.pathname.startsWith('/socket.io') || 
      event.request.method !== 'GET' ||
      url.pathname.startsWith('/api/') && !event.request.url.includes('/api/products') && !event.request.url.includes('/api/clients')) {
    return;
  }

  // Cache-first for static assets
  if (url.pathname.startsWith('/pos/assets/') || url.pathname.startsWith('/pos/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML/API reads, fall back to cache
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(r => r || caches.match(OFFLINE_URL)))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});
