const CACHE_NAME = 'top10-cache-v2';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/vite.svg', '/question-banks/manifest.json'];

async function getQuestionBankAssets() {
  try {
    const response = await fetch('/question-banks/manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    const manifest = await response.json();
    if (!manifest || !Array.isArray(manifest.banks)) {
      return [];
    }
    return manifest.banks
      .filter((bank) => bank && typeof bank.id === 'string' && bank.id)
      .map((bank) => `/question-banks/${bank.id}.json`);
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      const bankAssets = await getQuestionBankAssets();
      if (bankAssets.length > 0) {
        await cache.addAll(bankAssets);
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
