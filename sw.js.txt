/* INTEGRATED SUPERVISION WEST REGION — ATHECS
   Service worker: lets the app open with no network at all.
   NACC powered by ICAP Global Health © 2025-2026

   v4.3.4 made this STALE WHILE REVALIDATE: the cached copy is served at
   once, a conditional request goes out in the background, and a new
   APP_VERSION is announced to the page. That part was right and is kept.

   v4.3.6 fixes three things that could leave a phone on a screen that
   never opens. All three were mine.

   ① NO TIMEOUT ON THE NETWORK LEG. When the cache has no entry — the
      first launch, or straight after a cache purge — serve() awaited
      fetch() with nothing to stop it. A connection that STALLS rather
      than fails never settles that promise, so respondWith() never
      resolved and the phone sat on an empty screen indefinitely. There
      is now a hard deadline, and a readable page at the end of it.

   ② forceUpdate() DELETED EVERY CACHE AND THEN RELOADED. That is the
      exact state ① hangs in: an empty cache plus a bad connection. The
      new copy is now fetched FIRST and only swapped in once it is in
      hand (see REFRESH below); nothing is ever deleted before there is
      something to replace it with.

   ③ ?v= ENTRIES POISONED THE CACHE. The reload used
      index.html?v=<timestamp>, and the response was stored under that
      URL. Lookups use {ignoreSearch:true}, so a later plain request for
      index.html could match a ?v= entry from any earlier update and
      return it for ever — "I updated and nothing changed". Documents are
      now always stored under the canonical keys './index.html' and './',
      whatever query string asked for them.

   Nothing here ever touches localStorage, where enrolment, PINs and
   every unsent supervision live. A cache purge is not a data loss. */

const CACHE   = 'athecs-v5-7-0';
const VKEY    = './__athecs_version__';  /* not a real file: a marker kept in the cache */
const DOC     = './index.html';          /* the ONE key every document is stored under */
const NET_MS  = 7000;                    /* a stalled connection gets this long, no more */

/* The version stamp is written once, by build.py, into the head of the
   document. Reading it out of the response body is how this worker knows
   one index.html from another without trusting any header. */
function verOf(text){
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(text || '');
  return m ? m[1] : '';
}

/* v4.3.8 — WHY THIS IS NOT SIMPLY req.mode === 'navigate'
   It was, and that was wrong. Typing any address into the bar is a
   NAVIGATION, so asking for /icon-192.png or /manifest.webmanifest returned
   index.html from the cache: the app opened, appended its own #/home, and
   every file on the server appeared to exist whether it had been uploaded
   or not. A missing upload looked exactly like a successful one, which is
   the one thing a deployment check must never do.

   A path that names a FILE is that file, whoever asked for it. Everything
   else — a bare path, a folder, an .html — is the application, so deep
   links still open offline. */
/* ═══════════════════════════════════════════════════════════════════════════
   THE STANDALONE PAGES ARE NOT THIS WORKER'S TO ANSWER        (v4.12.0)

   reset.html and dashboard.html live beside index.html but are separate
   pages. isDoc() has always refused to serve the app shell in their place —
   correctly — but that left them on the ASSET path, and the asset path ends:

       if(!doc) return got || new Response('', {status:504, ...});

   Neither page is precached, so there is nothing in the cache. The network
   half is raced against NET_MS. Seven seconds is a long time in an office
   and no time at all on a phone in Bafang, so on a slow link the race was
   lost and THIS WORKER SYNTHESISED THE 504 — "took too long to respond,
   HTTP ERROR 504" — for a page that was sitting on the server perfectly
   well. In an installed app there is no address bar and no back button, so
   that error page was the end of the road.

   The worker now stands aside for them entirely: no respondWith, so the
   browser fetches them itself with its own timeout, its own cache and its
   own error page — and reset.html, whose whole job is to work when this
   worker is the problem, is no longer touched by it at all.
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   CLOUDFLARE PAGES STRIPS ".html", AND THAT BROKE THE DASHBOARD   (v5.6.2)

   Pages answers /dashboard.html with a 308 to /dashboard. The redirect is a
   NAVIGATION, so this worker saw a fresh request for a path with no dot and
   no extension, isDoc() said "a bare path is the application", and the public
   dashboard was answered with the cached app shell — the sign-in screen under
   the dashboard's address. Verified live on athecs.pages.dev before anyone in
   the field could meet it. The same applied to /reset, /update and /heal, so
   the three tools that exist to rescue a stuck phone would each have shown
   the very app they are there to replace.

   TWO CHANGES, and the second is the one that matters.

   ① The list below now matches the extensionless form as well.

   ② isDoc() is now a WHITELIST instead of a blacklist. The application is
      served for the folder root and for index.html, and for nothing else.
      Every previous fault in this function — the manifest written into the
      app's cache slot (v4.12.0), the 504 invented for reset.html (v4.12.0),
      this one — came from a rule that tried to name what is NOT the app
      while new files kept being added beside it. A rule that names what IS
      the app cannot be out of date by the time the next page is written.
      The app routes on the hash (#/home), never on the path, so there is
      no other path it is entitled to answer.
   ═══════════════════════════════════════════════════════════════════════════ */
const STANDALONE = /(^|\/)(reset|update|heal|dashboard)(\.html)?$/i;

function isDoc(req){
  let p;
  try{ p = new URL(req.url).pathname; }catch(e){ return false; }
  /* A standalone page is never the application, whether or not the host kept
     its .html — see the note above. */
  if(STANDALONE.test(p)) return false;
  /* The application lives at the folder root and at index.html. Anything else
     is somebody else's file and is fetched as one: a missing asset must still
     come back missing (the v4.3.7 lesson), and a page added beside index.html
     tomorrow is safe from this worker without anybody editing this line. */
  return p.endsWith('/') || /(^|\/)index\.html?$/i.test(p);
}

/* A promise that settles, whatever the network does. */
function withDeadline(p, ms){
  return Promise.race([
    p,
    new Promise(r => setTimeout(() => r(null), ms))
  ]);
}

async function announce(now, was){
  const cs = await self.clients.matchAll({includeUncontrolled:true, type:'window'});
  cs.forEach(c => { try{ c.postMessage({type:'ATHECS_NEW_VERSION', version:now, was:was||''}); }catch(e){} });
}

async function stored(cache){
  try{ const r = await cache.match(VKEY); return r ? await r.text() : ''; }
  catch(e){ return ''; }
}

/* One place that writes a document into the cache, so the keys can never
   drift apart and a ?v= URL can never become one of them. */
async function putDoc(cache, res){
  const body = await res.clone().text();
  /* Belt and braces after the fault above: whatever the routing decides,
     only the APPLICATION is ever written into the application's slot. */
  if(!/<html|APP_VERSION/i.test(body.slice(0, 4000))) return '';
  const mk = () => new Response(body, {status:200, headers:{'Content-Type':'text/html; charset=utf-8'}});
  await cache.put(DOC, mk());
  await cache.put('./', mk());
  const v = verOf(body);
  if(v) await cache.put(VKEY, new Response(v));
  return v;
}

/* The AHD readiness tool is exported by filling in the workbook CDC issued, so
   the app needs that workbook. It is a separate file rather than 134 KB of
   base64 inside index.html, and it is precached here: an assessor finishing a
   site with no network must still be able to produce the file. A failure to
   fetch it must not fail the install — the app works without the export. */
const EXTRA = ['./ahd-template.xlsx'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([DOC, './']).catch(() => c.add('./'))
        .then(() => Promise.all(EXTRA.map(u => c.add(u).catch(() => {})))))
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

self.addEventListener('message', e => {
  const d = (e && e.data) || {};
  const reply = msg => { try{ e.source && e.source.postMessage(msg); }catch(err){} };
  if(d.type === 'ATHECS_SKIP_WAITING'){ self.skipWaiting(); return; }
  if(d.type === 'ATHECS_CHECK'){ e.waitUntil(checkNow()); return; }
  /* REFRESH — what the update button asks for now. Fetch first, swap second,
     and say whether it worked. Nothing is deleted on a failure. */
  if(d.type === 'ATHECS_REFRESH'){ e.waitUntil(refresh().then(reply)); return; }
});

async function checkNow(){
  try{
    const cache = await caches.open(CACHE);
    const res = await withDeadline(
      fetch(new Request(DOC, {cache:'no-cache', credentials:'same-origin'})), NET_MS);
    if(!res || res.status !== 200) return;
    const was = await stored(cache);
    const now = await putDoc(cache, res);
    if(now && was && was !== now) await announce(now, was);
  }catch(e){ /* no signal: nothing to report, nothing broken */ }
}

/* Bypass every cache between here and the server, but keep the old copy
   until the new one is safely in hand. */
async function refresh(){
  try{
    const res = await withDeadline(
      fetch(new Request(DOC + '?r=' + Date.now(),
        {cache:'reload', credentials:'same-origin'})), NET_MS);
    if(!res || res.status !== 200)
      return {type:'ATHECS_REFRESH_DONE', ok:false, reason:'no-answer'};
    const cache = await caches.open(CACHE);
    const was = await stored(cache);
    const now = await putDoc(cache, res);          /* canonical keys only */
    return {type:'ATHECS_REFRESH_DONE', ok:true, version:now, was:was};
  }catch(e){
    return {type:'ATHECS_REFRESH_DONE', ok:false, reason:String(e)};
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (STANDALONE.test(url.pathname)) return;     /* see the note above isDoc() */
  const job = revalidate(e.request);
  e.waitUntil(job);
  e.respondWith(serve(e.request, job));
});

/* The background half: conditional, so an unchanged file costs an ETag
   round trip and not 594 KB. */
async function revalidate(req){
  try{
    const res = await withDeadline(
      fetch(new Request(req.url, {cache:'no-cache', credentials:'same-origin'})), NET_MS);
    if(!res || !res.ok || res.status !== 200) return res || null;
    const cache = await caches.open(CACHE);
    if(isDoc(req)){
      const was = await stored(cache);
      const now = await putDoc(cache, res);
      if(now && was && was !== now) await announce(now, was);
    }else{
      await cache.put(req, res.clone());
    }
    return res;
  }catch(e){ return null; }
}

/* The foreground half: whatever is on this phone already, at once —
   and, when there is nothing, an answer within NET_MS either way. */
async function serve(req, job){
  const cache = await caches.open(CACHE);
  const doc = isDoc(req);
  const hit = doc
    ? (await cache.match(DOC)) || (await cache.match('./'))
    : await cache.match(req, {ignoreSearch:true});
  if(hit) return hit;

  const got = await job;                       /* already deadlined */
  if(got && got.ok) return got;

  /* An ASSET that the server does not have must come back missing. Falling
     back to the app shell here was the other half of the v4.3.7 fault: a
     404 for icon-512.png was answered with index.html, so a file that had
     never been uploaded returned HTTP 200 and looked perfectly fine. */
  /* A missing ASSET must come back missing — that is the v4.3.7 lesson. But a
     NAVIGATION is a person looking at a screen, and a 504 invented here would
     put them on an error page with nothing to press. Let the browser own that
     failure: it has a reload button and knows how to say "no network". */
  if(!doc){
    if(req.mode === 'navigate') return got || Response.error();
    return got || new Response('', {status:504, statusText:'no answer'});
  }

  return (await cache.match(DOC))
      || (await cache.match('./'))
      || got
      || offlinePage();
}

/* Never a blank screen. If it comes to this, the phone is being told what
   happened and what to do, in both languages, from the worker itself. */
function offlinePage(){
  const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>ATHECS</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;'
    + 'background:#F5F8FC;color:#0F1723;display:flex;align-items:center;justify-content:center;'
    + 'min-height:100vh;padding:24px}div{max-width:420px}h1{font-size:1.1rem;color:#0B3C71;margin:0 0 12px}'
    + 'p{margin:0 0 10px;font-size:.95rem}button{margin-top:14px;padding:12px 18px;border:0;'
    + 'border-radius:10px;background:#0B3C71;color:#fff;font-size:1rem;font-weight:600}'
    + '</style></head><body><div>'
    + '<h1>ATHECS n’a pas pu s’ouvrir / could not open</h1>'
    + '<p>Cet appareil n’a pas encore de copie de l’application, et le serveur n’a pas '
    + 'répondu à temps.</p>'
    + '<p>Ouvrez l’application <b>une fois avec du réseau</b> : elle fonctionnera ensuite '
    + 'hors ligne. Rien de ce qui était enregistré sur ce téléphone n’est perdu.</p>'
    + '<p style="font-size:.85rem;color:#54617A">This device has no copy of the application yet and '
    + 'the server did not answer in time. Open it once with a network; nothing saved on this phone '
    + 'is lost.</p>'
    + '<button onclick="location.reload()">Réessayer / Retry</button>'
    + '</div></body></html>';
  return new Response(html, {status:200,
    headers:{'Content-Type':'text/html; charset=utf-8'}});
}
