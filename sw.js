// THE 15 PROJECT service worker — static assets only. Never caches API, auth or personal data.
const VERSION='t15-202611090235';
const PRECACHE=['/','/support.js','/manifest.webmanifest','/brand/favicon.svg','/brand/favicon.png','/brand/icon-192.png','/brand/icon-512.png','/brand/apple-touch-icon.png','/brand/logo-wide.svg','/brand/logo-desktop.svg','/icons/close.svg'];
const SKIP=/^\/(api|callback|recipe)(\/|$)/;
const STATIC=/\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|css|js|webmanifest)$/i;
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>Promise.all(PRECACHE.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET'||r.headers.has('range'))return;
  const u=new URL(r.url);
  const fonts=u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(u.origin!==self.location.origin&&!fonts)return;
  if(!fonts&&SKIP.test(u.pathname))return;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(res=>{if(res.ok&&u.pathname==='/'){const cp=res.clone();caches.open(VERSION).then(c=>c.put('/',cp));}return res;}).catch(()=>caches.match('/').then(m=>m||new Response('<h1 style="font-family:sans-serif;color:#fff;background:#000;margin:0;padding:40px">You\u2019re offline</h1>',{headers:{'Content-Type':'text/html'}}))));
    return;}
  if(!fonts&&!STATIC.test(u.pathname))return;
  e.respondWith(caches.open(VERSION).then(c=>c.match(r).then(hit=>{const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());return res;}).catch(()=>hit);return hit||net;})));
});
