const CACHE = 'aeola-web-c6693b37ca0ecf27'
const SHELL = ["index.html","app.c6693b37ca0ecf27.js","core-state.c6693b37ca0ecf27.js","wasi-shim.c6693b37ca0ecf27.js","audio-worklet.c6693b37ca0ecf27.js","buffered-audio.c6693b37ca0ecf27.js","buffered-worklet.c6693b37ca0ecf27.js","render-worker.c6693b37ca0ecf27.js","asset-decoder.c6693b37ca0ecf27.js","AeolaWeb.c6693b37ca0ecf27.wasm","icons.c6693b37ca0ecf27.js","symbol-icons.c6693b37ca0ecf27.js","strings.c6693b37ca0ecf27.json","identity.c6693b37ca0ecf27.json","initial-state.c6693b37ca0ecf27.json","favicon-48.png","brand-64.webp","favicon-16.png","brand-96.webp","brand-32.png","favicon-32.png","favicon.ico","manifest.webmanifest","LUCIDE-LICENSE","badges/app-store-en.svg","badges/app-store-pl.svg","badges/google-play-en.svg","badges/google-play-pl.svg","audio-chunks/index.json","audio-chunks/manifest.json"]
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
})
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aeola-web-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]))
})
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('range') || new URL(event.request.url).origin !== self.location.origin) return
  const navigation = event.request.mode === 'navigate'
  const url = new URL(event.request.url)
  const key = url.pathname.endsWith('/') ? new URL('index.html', url) : event.request
  if (navigation) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, response.clone())))
      return response
    }).catch(() => caches.match(key)))
    return
  }
  if (/\.[a-f0-9]{16}\.(?:js|css|wasm)$/.test(url.pathname) || url.pathname.includes('/audio-chunks/') || /\.(?:png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(caches.match(key).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, response.clone())))
      return response
    })))
    return
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, response.clone())))
    return response
  }).catch(() => caches.match(key)))
})
