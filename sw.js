// App shell and artwork use separate versioned caches. Artwork is cache-first
// and survives app-shell upgrades. Applies to HTTPS/localhost PWA installations.
const SHELL_CACHE='nightshift-shell-v4';
const IMAGE_CACHE='nightshift-art-v3';
const SHELL=['./','./index.html','./styles.css','./app.js','./assets/icon.svg','./manifest.webmanifest'];
const TRUSTED_ART=new Set(['media.githubusercontent.com','assets-bucket.deadlock-api.com','assets.deadlock-api.com','raw.githubusercontent.com']);
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('nightshift-shell-')&&n!==SHELL_CACHE || n.startsWith('nightshift-art-')&&n!==IMAGE_CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(req.destination==='image'&&TRUSTED_ART.has(url.hostname)){
   event.respondWith(caches.open(IMAGE_CACHE).then(async cache=>{
     const hit=await cache.match(req);if(hit)return hit;
     try{const res=await fetch(req);if(res.ok||res.type==='opaque'){
        // Cap image cache to keep the mobile app lightweight (approx. 250 pictures).
        try{const keys=await cache.keys();if(keys.length>=260)await cache.delete(keys[0]);await cache.put(req,res.clone())}catch{}
       }return res;
     }catch{ return Response.error() }
   }));return;
 }
 if(url.origin!==self.location.origin)return;
 if(url.pathname.includes('/data/')){
   event.respondWith(fetch(req).then(async res=>{if(res.ok){try{(await caches.open(SHELL_CACHE)).put(req,res.clone())}catch{}}return res}).catch(()=>caches.match(req)));
   return;
 }
 event.respondWith(fetch(req).then(async res=>{if(res.ok){try{(await caches.open(SHELL_CACHE)).put(req,res.clone())}catch{}}return res}).catch(()=>caches.match(req)));
});
