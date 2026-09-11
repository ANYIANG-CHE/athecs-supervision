/* INTEGRATED SUPERVISION WEST REGION — ATHECS
   Service worker: lets the app open with no network at all.
   NACC powered by ICAP Global Health © 2025-2026 */
const CACHE = 'athecs-v4-2-0';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['./', './index.html']).catch(() => c.add('./')))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first, cache fallback: a new version is picked up whenever the
   phone has signal, and the last good copy opens when it does not.
   Requests to the Google Apps Script API are never touched. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request)
        .then(m => m || caches.match('./index.html'))
        .then(m => m || caches.match('./'))
        .then(m => m || new Response('Hors ligne — ouvrez l\'application une fois avec du réseau.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});
