const CACHE = 'aeola-web-8e9753393c499a47'
const SHELL = ["index.html","app.8e9753393c499a47.js","core-state.8e9753393c499a47.js","wasi-shim.8e9753393c499a47.js","audio-worklet.8e9753393c499a47.js","buffered-audio.8e9753393c499a47.js","buffered-worklet.8e9753393c499a47.js","render-worker.8e9753393c499a47.js","asset-decoder.8e9753393c499a47.js","site-stores.8e9753393c499a47.mjs","AeolaWeb.8e9753393c499a47.wasm","icons.8e9753393c499a47.js","symbol-icons.8e9753393c499a47.js","strings.8e9753393c499a47.json","identity.8e9753393c499a47.json","initial-state.8e9753393c499a47.json","brand-32.png","brand-64.webp","brand-96.webp","favicon-16.png","favicon-32.png","favicon-48.png","icon-192.png","favicon.ico","manifest.webmanifest","LUCIDE-LICENSE","badges/app-store-en.svg","badges/app-store-pl.svg","badges/google-play-en.svg","badges/google-play-pl.svg","badges/mac-app-store-en.svg","badges/mac-app-store-pl.svg","audio-chunks/index.json","audio-chunks/manifest.json"]
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
