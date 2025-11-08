const CACHE_NAME = 'gestor-compras-cache-v3';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/index.tsx'
];

// URLs that should be cached as they are requested
const DYNAMIC_CACHE_WHITELIST = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'aistudiocdn.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache, caching app shell');
        return cache.addAll(APP_SHELL_URLS);
      })
      .catch(error => {
          console.error('Failed to cache app shell during install:', error);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore Firebase and other API calls. Let the app's logic handle them.
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis.com')) {
    return;
  }
  
  // For navigation requests, serve the index.html (SPA support)
  if (request.mode === 'navigate') {
    event.respondWith(
        caches.match('/index.html')
            .then(response => {
                return response || fetch(request);
            })
    );
    return;
  }

  // For other requests (CSS, JS, images), use a cache-then-network strategy
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then(networkResponse => {
            const isWhitelisted = DYNAMIC_CACHE_WHITELIST.some(domain => url.hostname.includes(domain));
            const isSameOrigin = url.origin === self.location.origin;

            if (networkResponse && networkResponse.status === 200 && (isSameOrigin || isWhitelisted)) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(request, responseToCache);
                    });
            }
            return networkResponse;
        });
      }).catch(error => {
          console.error('Service Worker fetch failed:', error);
      })
  );
});