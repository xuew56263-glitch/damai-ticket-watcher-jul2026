const CACHE = 'damai-monitor-v1';
const ASSETS = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname.endsWith('/status.json')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
