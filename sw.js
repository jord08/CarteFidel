'use strict';
// Incrémenter la version à chaque modification des fichiers ci-dessous (le numéro est affiché dans le menu de l'application).
const CACHE = 'cartefidel-v19';
// Fichiers indispensables : si l'un manque, la nouvelle version n'est pas installée (l'ancienne reste utilisable).
const FICHIERS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/bwip-js-min.js', 'lib/zxing.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'logos/index.json',
];

// cache: 'reload' contourne le cache HTTP du navigateur (sinon d'anciens fichiers
// encore « frais » pourraient être figés dans la nouvelle version).
const frais = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(FICHIERS.map(frais));
      // Les logos sont facultatifs : un logo introuvable ne doit pas bloquer toute la mise à jour
      // (il sera mis en cache à la demande, voir « fetch »).
      const logos = await (await c.match('logos/index.json')).json();
      await Promise.allSettled(logos.map((l) => c.add(frais(l.fichier))));
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
// Cache d'abord : démarrage instantané, même sans réseau. Ce qui manque est pris sur le réseau puis mémorisé.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((reponse) => {
      if (reponse.ok && new URL(e.request.url).origin === location.origin) {
        const copie = reponse.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
      }
      return reponse;
    })),
  );
});
