// Navigators Club web app — RETIRED.
//
// The web app moved to https://app.seamanapp.com. This service worker used to
// cache the /app shell, which would otherwise hijack the redirect for anyone
// who previously installed the PWA. This stub unregisters itself and wipes all
// caches so returning visitors release control and fall through to the
// redirect in /app/index.html (and 404.html).

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) { /* ignore */ }
  })());
});

// Never intercept any request — always let the network handle it.
