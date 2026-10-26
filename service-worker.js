const CACHE = 'aeola-web-80649ae669255184'
const SHELL = ["index.html","app.80649ae669255184.js","core-state.80649ae669255184.js","wasi-shim.80649ae669255184.js","audio-worklet.80649ae669255184.js","buffered-audio.80649ae669255184.js","buffered-worklet.80649ae669255184.js","render-worker.80649ae669255184.js","asset-decoder.80649ae669255184.js","site-stores.80649ae669255184.mjs","AeolaWeb.80649ae669255184.wasm","icons.80649ae669255184.js","symbol-icons.80649ae669255184.js","strings.80649ae669255184.json","identity.80649ae669255184.json","initial-state.80649ae669255184.json","brand-32.png","brand-64.webp","brand-96.webp","favicon-16.png","favicon-32.png","favicon-48.png","icon-192.png","favicon.ico","manifest.webmanifest","LUCIDE-LICENSE","badges/app-store-en.svg","badges/app-store-pl.svg","badges/google-play-en.svg","badges/google-play-pl.svg","badges/mac-app-store-en.svg","badges/mac-app-store-pl.svg","audio-chunks/index.json","audio-chunks/manifest.json"]
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
