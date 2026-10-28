# CarteFidel
Portefeuille de cartes de fidélité, installable sur téléphone (PWA), pensé pour démarrer vite. Les cartes restent sur le téléphone : aucun serveur, aucun envoi.

- Fonctionne hors-ligne (service worker, bibliothèques embarquées dans `lib/`)
- Cartes triées par nombre d'utilisations (puis par dernière utilisation), recherche (sans accent) à partir de 6 cartes
- Code-barres ou QR code au choix, mémorisé par carte ; écran maintenu allumé pendant l'affichage d'un code
- Ajout d'une carte : scan en direct avec la caméra, par photo ou depuis la galerie, ou saisie du numéro
- Modification du nom et du logo d'une carte (le logo automatique suit le nouveau nom)
- Les fenêtres se ferment d'un clic à côté (sur le fond grisé)
- Logos d'enseignes ajoutés automatiquement d'après le nom (voir plus bas)
- Stockage IndexedDB ; menu ⋮ : **Partager** (feuille de partage du système), **Exporter** (sauvegarde complète), **Importer**, numéro de version

## Sauvegarde, partage, import
- **Exporter** : fichier `cartes-AAAA-MM-JJ.json` avec tout (logos, historique d'usage). À garder pour restaurer.
- **Partager** : fichier `.txt` allégé (sans historique d'usage ni logos d'enseignes connues, retrouvés par nom à l'import). Chrome sur Android refuse les fichiers `.json` dans la feuille de partage.
- **Importer** : accepte `.json` ou `.txt`. Vérifie chaque carte, n'écrase jamais une carte existante, ignore les doublons (même identifiant ou même numéro) et les cartes invalides.
- Les exports contiennent les numéros de cartes : ils sont ignorés par Git (`.gitignore`), ne les commitez jamais.

## Développement
Servir le dossier en HTTP(S), par exemple `npx serve .`, puis ouvrir `http://localhost:3000`.
**Après toute modification des fichiers, incrémenter `CACHE` dans `sw.js`** (sinon les téléphones gardent l'ancienne version). Ce numéro est celui affiché dans le menu de l'application. À chaque nouvelle version, la page se recharge d'elle-même une fois la mise à jour installée.

## Installation sur Android (Pixel)
Héberger le dossier en HTTPS (ex. GitHub Pages), ouvrir l'URL dans Chrome, puis menu ⋮ > « Installer l'application ».

## Logos d'enseignes
`logos/` contient des logos issus de [Simple Icons](https://simpleicons.org) (v13.21.0, licence CC0), colorés à la couleur de la marque, de Wikimedia Commons et des sites officiels des enseignes (usage privé). Les marques restent la propriété de leurs détenteurs : dépôt à usage privé.

Pour en ajouter : déposer le fichier dans `logos/`, l'ajouter à `logos/index.json` (`nom`, `fichier`, `alias`) et incrémenter `CACHE` dans `sw.js`. Pour un logo blanc sur transparent, ajouter `fond` (couleur) et éventuellement `recadrage` (`[x, y, largeur, hauteur]`).

Origine du logo d'une carte (champ `origineLogo`) : `catalogue` (suit le nom de l'enseigne), `perso` (image choisie, jamais remplacée), `retire` (retiré exprès, pas de ré-ajout automatique) ; absent pour une carte ancienne, dont l'origine est alors déduite du nom au démarrage.

Crédits : les logos Micromania (CC BY-SA 4.0) et Jardiland (CC BY-SA 3.0) viennent de Wikimedia Commons ; ceux de Casino, Coccimarket, Weldom et Yves Rocher y sont indiqués comme domaine public (marques déposées).
