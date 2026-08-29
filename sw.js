const CACHE = 'st-thomas-library-v3';

const PRECACHE = [
  '/',
  '/index.html',
  '/catalog.html',
  '/login.html',
  '/books.html',
  '/students.html',
  '/volunteers.html',
  '/donate.html',
  '/donations-admin.html',
  '/css/main.css',
  '/css/components.css',
  '/js/pwa.js',
  '/js/firebase-config.js',
  '/js/auth.js',
  '/js/books.js',
  '/js/checkouts.js',
  '/js/donations.js',
  '/js/isbn-scan.js',
  '/js/students.js',
  '/js/ui.js',
  '/js/volunteers.js',
  '/manifest.webmanifest',
  '/icons/church-logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(
        PRECACHE.map((url) => new Request(url, { cache: 'reload' })),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

function isStaticAsset(pathname) {
  return pathname.startsWith('/css/')
    || pathname.startsWith('/js/')
    || pathname.startsWith('/icons/')
    || pathname === '/manifest.webmanifest';
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await matchCached(cache, request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await matchCached(cache, request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const fallback = await cache.match('/catalog.html');
      if (fallback) return fallback;
    }

    throw new Error('Offline and no cached response available.');
  }
}

async function matchCached(cache, request) {
  const exact = await cache.match(request);
  if (exact) return exact;

  const bareUrl = new URL(request.url);
  bareUrl.search = '';
  return cache.match(bareUrl);
}
