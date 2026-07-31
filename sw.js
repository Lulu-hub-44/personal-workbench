/* 个人工作台 Service Worker —— 让应用可“安装到桌面/主屏”并支持离线 */
const CACHE = "wb-v2";
const ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // 同步接口始终走网络，禁止缓存（避免拉到旧数据）
  if (req.url.includes("/sync") || req.url.includes("__sync=1")) {
    e.respondWith(fetch(req));
    return;
  }
  // 应用代码(JS/CSS)始终走网络、不写入缓存，保证每次都拿到最新版本
  if (req.url.endsWith("/app.js") || req.url.endsWith("/styles.css") ||
      req.url.includes("/app.js?") || req.url.includes("/styles.css?")) {
    e.respondWith(fetch(req));
    return;
  }
  // 其余静态资源：网络优先，成功后写入缓存；失败则回退缓存（离线可用）
  e.respondWith(
    fetch(req)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
  );
});
