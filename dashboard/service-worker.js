const CACHE='jarvis-pwa-v2';
const SHELL=['/dashboard','/dashboard/manifest.webmanifest','/dashboard/icons/icon-192.png','/dashboard/icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(u.pathname.startsWith('/api/')) return;
  if(event.request.method!=='GET') return;
  event.respondWith(fetch(event.request).then(r=>{
    if(r.ok && u.origin===location.origin){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});} return r;
  }).catch(()=>caches.match(event.request).then(r=>r || caches.match('/dashboard'))));
});
