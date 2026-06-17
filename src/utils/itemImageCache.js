const MAX_WARMED_IMAGES = 600;

function warmWithImageObjects(urls) {
  urls.slice(0, MAX_WARMED_IMAGES).forEach((url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  });
}

export function warmItemImageCache(urls) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))].slice(0, MAX_WARMED_IMAGES);
  if (uniqueUrls.length === 0 || typeof window === 'undefined') return;

  if (!('serviceWorker' in navigator)) {
    warmWithImageObjects(uniqueUrls);
    return;
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      if (!registration.active) {
        warmWithImageObjects(uniqueUrls);
        return;
      }

      registration.active.postMessage({
        type: 'CACHE_ITEM_IMAGES',
        urls: uniqueUrls,
      });
    })
    .catch(() => warmWithImageObjects(uniqueUrls));
}
