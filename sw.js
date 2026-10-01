// 已停用旧缓存策略：每次都走网络并清空旧缓存，避免 stale 内容。
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); })
      .then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function(e){ e.respondWith(fetch(e.request)); });
