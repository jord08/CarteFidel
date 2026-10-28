# CarteFidel
Portefeuille de cartes de fidélité, installable sur téléphone (PWA), pensé pour démarrer vite.

- Fonctionne hors-ligne (service worker, bibliothèques embarquées dans `lib/`)
- Cartes triées par dernière utilisation, recherche à partir de 6 cartes
- Écran maintenu allumé pendant l'affichage d'un code
- Scan du code-barres par photo ou galerie
- Stockage IndexedDB, export/import JSON (menu ⋮)

## Développement
Servir le dossier en HTTP(S), par exemple `npx serve .`, puis ouvrir `http://localhost:3000`.
Après toute modification des fichiers, incrémenter `CACHE` dans `sw.js`.

## Installation sur Android (Pixel)
Héberger le dossier en HTTPS (ex. GitHub Pages), ouvrir l'URL dans Chrome, puis menu ⋮ > « Installer l'application ».
