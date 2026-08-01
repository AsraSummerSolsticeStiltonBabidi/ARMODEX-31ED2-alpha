/* ARMODEX service worker.

   Deliberately NO version number to bump by hand.

   The app itself (any navigation / .html request) is fetched NETWORK-FIRST: while you have a
   connection you always get whatever is currently on GitHub, so uploading a new build is enough --
   nothing here has to be edited to make it take effect. The cached copy is written on every
   successful fetch and is used only as the offline fallback.

   The icons and the manifest are CACHE-FIRST, because they're small, rarely change, and this is
   what makes a cold offline start instant. If one of them ever does change, the new copy is picked
   up in the background on the next online visit.
*/
const CACHE = 'armodex';
const SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(CACHE)
      // Added one by one: addAll() rejects the whole install if any single file 404s, and a
      // missing icon should never stop the app itself from being available offline.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(()=>{}))))
      .then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only ever handle our own origin. Google Drive sync, Google's identity library and the audio
  // samples must reach the network untouched and must never be cached.
  if(url.origin !== self.location.origin) return;

  const isAppShell = req.mode === 'navigate'
    || (req.destination === 'document')
    || url.pathname.endsWith('.html');

  if(isAppShell){
    // Network first: a fresh upload wins immediately, offline falls back to the last good copy.
    e.respondWith(
      fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> caches.match('./index.html').then(hit => hit || caches.match(req)))
    );
    return;
  }

  // Everything else (icons, manifest): cache first, refreshed quietly in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> hit);
      return hit || net;
    })
  );
});
