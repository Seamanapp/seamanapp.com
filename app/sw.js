// Navigators Club web app — service worker.
//
// Scope: caches the APP SHELL only (html/css/js/vendor/icons under /app/) so
// the installed PWA can open offline and show a usable screen. It NEVER
// caches anything cross-origin — Supabase API/auth calls, the lms-media
// Edge Function, or the short-lived signed R2 video URLs it returns. Those
// must always be fetched fresh (a cached signed URL would be stale/expired,
// and course video must never be persisted to disk by this service worker).

const CACHE_NAME = 'navclub-app-shell-v5';
const SCOPE = self.registration.scope; // e.g. https://seamanapp.com/app/

// Real, individually-addressable files only. The bare scope root ('/app/')
// is NOT a distinct resource here — some hosts serve it as index.html
// automatically (GitHub Pages does), others don't, so the fetch handler
// below maps that request onto the cached 'index.html' entry explicitly
// rather than relying on a server's directory-index behaviour.
const SHELL_FILES = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'vendor/supabase.js',
  'vendor/hls.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each file independently (not cache.addAll, which is all-or-
      // nothing) so one slow/unavailable file can't sink the whole install
      // and leave the PWA with no offline shell at all.
      Promise.all(
        SHELL_FILES.map((f) => {
          const abs = new URL(f, SCOPE).toString();
          return fetch(abs, { cache: 'reload' })
            .then((res) => { if (res.ok) return cache.put(abs, res); })
            .catch(() => {});
        })
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST (auth/RPC/functions)

  // Only ever handle same-origin requests that live under this app's scope
  // AND are one of the precached shell files. Everything else (Supabase
  // auth/rest/rpc/functions, R2 signed video URLs, any other path on the
  // site) is left completely untouched — the browser fetches it live,
  // every time, with no interception at all.
  if (!req.url.startsWith(SCOPE)) return;

  let relative = req.url.slice(SCOPE.length).split('?')[0];
  if (relative === '') relative = 'index.html'; // the bare "/app/" request
  if (!SHELL_FILES.includes(relative)) return; // never cache anything not explicitly listed

  const cacheKey = new URL(relative, SCOPE).toString();

  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      if (cached) {
        // Cache-first for instant offline shell load; refresh in the
        // background so the next launch picks up a redeploy.
        fetch(req).then((fresh) => {
          if (fresh && fresh.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, fresh));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((fresh) => {
        if (fresh && fresh.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, fresh.clone()));
        }
        return fresh;
      });
    })
  );
});
