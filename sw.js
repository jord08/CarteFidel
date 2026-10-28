'use strict';
// Incrémenter la version à chaque modification des fichiers ci-dessous.
const CACHE = 'cartefidel-v17';
const FICHIERS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/bwip-js-min.js', 'lib/zxing.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'logos/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // cache: 'reload' contourne le cache HTTP du navigateur (sinon d'anciens fichiers
      // encore « frais » pourraient être figés dans la nouvelle version).
      const frais = (urls) => c.addAll(urls.map((u) => new Request(u, { cache: 'reload' })));
      await frais(FICHIERS);
      const logos = await (await c.match('logos/index.json')).json();
      await frais(logos.map((l) => l.fichier));
    }).then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Cache d'abord : démarrage instantané, même sans réseau.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
