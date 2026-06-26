const CACHE_NAME = 'militant-albion-item-images-v1';
const MAX_CACHE_ENTRIES = 1200;
const ALBION_RENDER_HOST = 'render.albiononline.com';
const IMAGE_PROXY_HOST = 'images.weserv.nl';

function isAlbionItemImageUrl(url) {
  return (url.hostname === IMAGE_PROXY_HOST && url.searchParams.has('url'))
    || (url.hostname === ALBION_RENDER_HOST && url.pathname.startsWith('/v1/item/'))
    || url.pathname.startsWith('/item-image/');
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;

  await Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map((key) => cache.delete(key)));
}

async function cacheItemImage(url) {
  const itemUrl = new URL(url, self.location.origin);
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(itemUrl.href);
  if (cached) return cached;

  const response = itemUrl.hostname === ALBION_RENDER_HOST
    ? await fetch(itemUrl.href, { mode: 'no-cors', credentials: 'omit' })
    : await fetch(itemUrl.href, { credentials: itemUrl.origin === self.location.origin ? 'same-origin' : 'omit' });

  if (response && response.ok ) {
    await cache.put(itemUrl.href, response.clone());
    await trimCache(cache);
  }

  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!isAlbionItemImageUrl(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request.url);
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response && response.ok ) {
      await cache.put(event.request.url, response.clone());
      await trimCache(cache);
    }

    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_ITEM_IMAGES' || !Array.isArray(event.data.urls)) return;

  const urls = event.data.urls
    .filter((url) => {
      try {
        return isAlbionItemImageUrl(new URL(url, self.location.origin));
      } catch {
        return false;
      }
    })
    .slice(0, MAX_CACHE_ENTRIES);

  event.waitUntil(Promise.allSettled(urls.map(cacheItemImage)));
});
