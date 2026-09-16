/* INTEGRATED SUPERVISION WEST REGION — ATHECS
   Service worker: lets the app open with no network at all.
   NACC powered by ICAP Global Health © 2025-2026

   WHY THIS FILE CHANGED IN v4.3.4
   ───────────────────────────────
   Until v4.3.3 this worker was NETWORK FIRST with no timeout. Two field
   reports came straight out of that one line:

   1. "the app is slow to open". On a good connection nobody notices. On a
      district road with one bar, the phone sat waiting for the whole of
      index.html before drawing anything, because the cached copy was only
      consulted after the network gave up — and a stalled connection never
      gives up, it just stays slow. The app was as slow as the worst signal
      of the day.

   2. "supervisors keep refreshing and stay on v4.0.0". Network first still
      goes through the phone's ORDINARY HTTP CACHE. If the host answered
      that request from cache — and a static host will, for hours — the
      worker faithfully re-cached the SAME OLD FILE, for ever. Refreshing
      could not break the loop because every refresh asked the same
      question and got the same stale answer.

   What it does now — STALE WHILE REVALIDATE:
     · the cached copy is served IMMEDIATELY, so the app opens at the speed
       of the phone's own storage, signal or no signal;
     · a conditional request goes out in the background (cache:'no-cache'
       sends the ETag, so an unchanged file costs a few hundred bytes, not
       574 KB) — this is what breaks the stale-HTTP-cache loop;
     · when the copy that comes back carries a different APP_VERSION, the
       new copy is cached and every open tab is TOLD, by postMessage. The
       page then shows the update banner. Nobody has to notice anything.

   Nothing here ever touches localStorage, where enrolment, PINs and every
   unsent supervision live. A cache purge is not a data loss. */

const CACHE = 'athecs-v4-3-4';
const VKEY  = './__athecs_version__';   /* not a real file: a marker we keep in the cache */

/* The version stamp is written once, by build.py, into the head of the
   document. Reading it out of the response body is how this worker knows
   one index.html from another without trusting any header. */
function verOf(text){
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(text || '');
  return m ? m[1] : '';
}

function isDoc(req){
  if(req.mode === 'navigate') return true;
  let p; try{ p = new URL(req.url).pathname; }catch(e){ return false; }
  return p.endsWith('/') || /\.html?$/.test(p);
}

async function announce(now, was){
  const cs = await self.clients.matchAll({includeUncontrolled:true, type:'window'});
  cs.forEach(c => { try{ c.postMessage({type:'ATHECS_NEW_VERSION', version:now, was:was||''}); }catch(e){} });
}

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

/* The page can ask three things of this worker. */
self.addEventListener('message', e => {
  const d = (e && e.data) || {};
  if(d.type === 'ATHECS_SKIP_WAITING'){ self.skipWaiting(); return; }
  if(d.type === 'ATHECS_CHECK'){ e.waitUntil(checkNow()); return; }
  if(d.type === 'ATHECS_PURGE'){
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});

/* An explicit "is there a new version?", asked by the page at start-up and
   again whenever the phone regains signal. Conditional, so it is nearly
   free when the answer is no. */
async function checkNow(){
  try{
    const cache = await caches.open(CACHE);
    const res = await fetch(new Request('./index.html',
      {cache:'no-cache', credentials:'same-origin'}));
    if(!res || res.status !== 200) return;
    const txt = await res.clone().text();
    const now = verOf(txt);
    if(!now) return;
    const was = await stored(cache);
    await cache.put('./index.html', res.clone());
    await cache.put('./', res.clone());
    await cache.put(VKEY, new Response(now));
    if(was && was !== now) await announce(now, was);
  }catch(e){ /* no signal: nothing to report, nothing broken */ }
}

async function stored(cache){
  try{ const r = await cache.match(VKEY); return r ? await r.text() : ''; }
  catch(e){ return ''; }
}

/* waitUntil keeps the worker alive for the background half. Without it the
   browser is free to kill the worker the moment the cached copy is handed
   over, and the revalidation — the whole point — would be cut off. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  const job = revalidate(e.request);
  e.waitUntil(job);
  e.respondWith(serve(e.request, job));
});

/* The background half: conditional, so an unchanged file costs an ETag
   round trip and not 583 KB. */
async function revalidate(req){
  try{
    const res = await fetch(new Request(req.url, {cache:'no-cache', credentials:'same-origin'}));
    if(!res || !res.ok || res.status !== 200) return res || null;
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
    if(isDoc(req)){
      const now = verOf(await res.clone().text());
      if(now){
        const was = await stored(cache);
        await cache.put(VKEY, new Response(now));
        if(was && was !== now) await announce(now, was);
      }
    }
    return res;
  }catch(e){ return null; }
}

/* The foreground half: whatever is on this phone already, at once. */
async function serve(req, job){
  const cache = await caches.open(CACHE);
  const hit   = await cache.match(req, {ignoreSearch:true});
  if(hit) return hit;
  const got = await job;
  if(got && got.ok) return got;
  return (await cache.match('./index.html'))
      || (await cache.match('./'))
      || got
      || new Response('Hors ligne — ouvrez l\'application une fois avec du réseau.',
           { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
