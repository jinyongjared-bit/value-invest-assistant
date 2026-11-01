// Service Worker for 价值投资助手 PWA
// Version: 1.0.0

const CACHE_NAME = 'value-invest-v1';
const APP_SHELL = [
  './',
  './stock-tracker.html',
  './preview.html',
  './manifest.json',
  './icons/icon.svg',
  './lib/echarts.min.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL).catch(err => {
          console.warn('[SW] Some resources failed to cache:', err);
          // Cache what we can - don't fail the whole install
          return Promise.all(
            APP_SHELL.map(url => 
              cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e))
            )
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: network first for API calls, cache first for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  const url = new URL(request.url);
  
  // Skip chrome-extension://, file://, and other non-http protocols
  if (!['http:', 'https:'].includes(url.protocol)) {
    return;
  }
  
  // Skip API calls to external services (let them go to network)
  if (url.hostname.includes('sina') || 
      url.hostname.includes('tencent') || 
      url.hostname.includes('10jqka') ||
      url.hostname.includes('eastmoney')) {
    return; // Network only for financial data
  }
  
  // For same-origin static assets: cache first, network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version, but also update cache in background
            fetch(request)
              .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                  const responseClone = networkResponse.clone();
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseClone);
                  });
                }
              })
              .catch(() => {}); // Ignore network errors when updating cache
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          return fetch(request)
            .then((networkResponse) => {
              // Cache the new resource for next time
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // Offline: return offline page if available
              return caches.match('./stock-tracker.html');
            });
        })
    );
  }
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] Service worker loaded');
