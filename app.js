'use strict';

const $ = (id) => document.getElementById(id);
const ANCIENNE_CLE = 'cartefidel-cartes';
const MODE_QR = 'qrcode';
const SYMBOLOGIE_QR = 'qrcode'; // symbologie bwip-js (à ne pas confondre avec MODE_QR : préférence d'affichage)
const ORIGINES_LOGO = ['catalogue', 'perso', 'retire'];
const TAILLE_LOGO_MAX = 300; // px, pour les logos importés par l'utilisateur
const TAILLE_IMPORT_MAX = 10 * 1024 * 1024; // octets

// --- Utilitaires ------------------------------------------------------------
// Comparaison de noms : sans accents, majuscules ni ponctuation.
const normaliser = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fermerAvec = (idBouton, idDialog) => $(idBouton).addEventListener('click', () => $(idDialog).close());
const couperFlux = (flux) => flux?.getTracks().forEach((piste) => piste.stop());
function montrerApercu(img, src) {
  img.hidden = !src;
  if (src) img.src = src;
}
async function lireJson(url) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`${url} : ${reponse.status}`);
  return reponse.json();
}
const lireFichier = (f) => new Promise((ok, ko) => {
  const lecteur = new FileReader();
  lecteur.onload = () => ok(lecteur.result); lecteur.onerror = ko;
  lecteur.readAsDataURL(f);
});

// Réduit l'image pour le stockage local
function reduire(url) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, TAILLE_LOGO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      ok(canvas.toDataURL('image/png'));
    };
    img.onerror = () => ok(url);
    img.src = url;
  });
}

// --- Cartes : forme et validation -------------------------------------------
// Une carte : { id, nom, code, format, logo, mode?, origineLogo?, dernier, usages }
//  - format : symbologie bwip-js détectée au scan (sinon deviné)
//  - mode : MODE_QR si l'utilisateur préfère le QR code (absent = code-barres)
//  - origineLogo : 'catalogue' (suit le nom de l'enseigne), 'perso' (image choisie, jamais remplacée),
//    'retire' (retiré exprès : pas de ré-ajout automatique) ; absent = origine inconnue (carte ancienne)
// Rend une carte propre (types vérifiés, champs inconnus écartés) ou null si elle est inutilisable.
// Sert aussi bien à la lecture de la base qu'à l'import d'un fichier.
function nettoyerCarte(c) {
  if (!c || typeof c !== 'object') return null;
  const nom = typeof c.nom === 'string' ? c.nom.trim() : '';
  const code = typeof c.code === 'string' || typeof c.code === 'number' ? String(c.code).trim() : '';
  if (!nom || !code) return null;
  const carte = {
    id: typeof c.id === 'string' && c.id ? c.id : nouvelId(),
    nom,
    code,
    format: typeof c.format === 'string' ? c.format : null,
    logo: typeof c.logo === 'string' && c.logo.startsWith('data:image/') && c.logo.length < 600000 ? c.logo : null,
    dernier: Number.isFinite(c.dernier) ? c.dernier : 0,
    usages: Number.isFinite(c.usages) ? c.usages : 0,
  };
  if (c.mode === MODE_QR) carte.mode = MODE_QR;
  // Un logo absent ne peut venir ni du catalogue ni de l'utilisateur (ex. image trop grosse écartée).
  if (ORIGINES_LOGO.includes(c.origineLogo) && (carte.logo || c.origineLogo === 'retire')) carte.origineLogo = c.origineLogo;
  return carte;
}

// --- Stockage (IndexedDB) ---------------------------------------------------
const baseOuverte = new Promise((ok, ko) => {
  const ouverture = indexedDB.open('cartefidel', 1);
  ouverture.onupgradeneeded = () => ouverture.result.createObjectStore('cartes', { keyPath: 'id' });
  ouverture.onsuccess = () => ok(ouverture.result);
  ouverture.onerror = () => ko(ouverture.error);
});
async function transaction(mode, fn) {
  const db = await baseOuverte;
  return new Promise((ok, ko) => {
    const t = db.transaction('cartes', mode);
    const requete = fn(t.objectStore('cartes'));
    t.oncomplete = () => ok(requete && requete.result);
    t.onerror = t.onabort = () => ko(t.error);
  });
}
const toutes = () => transaction('readonly', (s) => s.getAll());
const enregistrer = (c) => transaction('readwrite', (s) => s.put(c));
const retirer = (id) => transaction('readwrite', (s) => s.delete(id));

// Reprise des cartes de l'ancienne version (localStorage), une seule fois.
async function migrer() {
  try {
    const anciennes = JSON.parse(localStorage.getItem(ANCIENNE_CLE));
    if (Array.isArray(anciennes)) for (const c of anciennes) await enregistrer({ dernier: 0, ...c });
    localStorage.removeItem(ANCIENNE_CLE);
  } catch (e) { /* rien à migrer */ }
}

// --- Chargement paresseux des bibliothèques (hors du chemin de démarrage) ---
const charges = {};
const charger = (src) => charges[src] ||= new Promise((ok, ko) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => { delete charges[src]; ko(new Error(src)); };
  document.head.append(s);
});
const optionsZXing = () => new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);

// Formats ZXing / BarcodeDetector (en minuscules) -> symbologies bwip-js
const BWIP = {
  ean_13: 'ean13', ean_8: 'ean8', upc_a: 'upca', upc_e: 'upce',
  code_128: 'code128', code_39: 'code39', itf: 'interleaved2of5', codabar: 'rationalizedCodabar',
  qr_code: 'qrcode', data_matrix: 'datamatrix', pdf_417: 'pdf417', pdf417: 'pdf417', aztec: 'azteccode',
};
const symbologie = (format) => BWIP[String(format).toLowerCase()] || null;
let formatDetecte = null;

// --- Liste ------------------------------------------------------------------
let cartes = [];

function afficher() {
  const filtre = normaliser($('recherche').value);
  $('recherche').hidden = cartes.length < 6;
  $('vide').hidden = cartes.length > 0;
  const grille = $('grille');
  grille.replaceChildren();
  const liste = cartes
    .filter((c) => normaliser(c.nom).includes(filtre))
    .sort((a, b) => b.usages - a.usages || b.dernier - a.dernier);
  for (const c of liste) {
    const bouton = document.createElement('button');
    bouton.className = 'carte';
    bouton.type = 'button';
    if (c.logo) {
      const img = document.createElement('img');
      img.src = c.logo; img.alt = c.nom;
      bouton.append(img);
    } else {
      bouton.textContent = c.nom;
    }
    bouton.addEventListener('click', () => ouvrir(c));
    grille.append(bouton);
  }
}
$('recherche').addEventListener('input', afficher);

// --- Affichage d'un code ----------------------------------------------------
// Dessine le code et renvoie la symbologie réellement utilisée (ou null si rien ne convient).
async function dessiner(c) {
  await charger('lib/bwip-js-min.js');
  const canvas = $('canvas-code');
  canvas.width = canvas.width; // efface le dessin de la carte précédente
  const types = c.mode === MODE_QR
    ? [SYMBOLOGIE_QR]
    : [c.format, /^\d{13}$/.test(c.code) ? 'ean13' : null, 'code128', SYMBOLOGIE_QR];
  for (const t of types) {
    if (!t) continue;
    try {
      bwipjs.toCanvas(canvas, { bcid: t, text: c.code, scale: t === SYMBOLOGIE_QR ? 6 : 4, height: 18, includetext: false, paddingwidth: 8, paddingheight: 8 });
      return t;
    } catch (e) { /* format suivant */ }
  }
  return null;
}

// Bascule code-barres / QR code (choix mémorisé par carte). L'interrupteur reflète ce qui est vraiment dessiné.
async function afficherCode(c) {
  const dessine = await dessiner(c);
  const qr = dessine === SYMBOLOGIE_QR;
  $('mode-barres').setAttribute('aria-pressed', String(!qr));
  $('mode-qr').setAttribute('aria-pressed', String(qr));
  $('canvas-code').classList.toggle('qr', qr);
  $('canvas-code').hidden = !dessine;
  $('code-num').textContent = dessine ? c.code : `${c.code} — impossible à dessiner en code-barres`;
  // Rien à basculer si la carte est déjà un QR ou si rien ne peut être dessiné.
  $('bascule').hidden = !dessine || c.format === SYMBOLOGIE_QR;
}
for (const [id, mode] of [['mode-barres', undefined], ['mode-qr', MODE_QR]]) {
  $(id).addEventListener('click', async () => {
    if (!ouverte || ouverte.mode === mode) return;
    if (mode) ouverte.mode = mode; else delete ouverte.mode;
    await afficherCode(ouverte);
    enregistrer(ouverte).catch(() => {});
  });
}

let ouverte = null;
let verrou = null;
let jetonVerrou = 0; // invalide les demandes de verrou en cours quand la fenêtre se ferme

// Garde l'écran allumé pendant le passage en caisse.
async function verrouillerEcran() {
  if (verrou) return;
  const jeton = ++jetonVerrou;
  try {
    const v = await navigator.wakeLock?.request('screen');
    if (!v) return;
    // Fenêtre fermée pendant l'attente, ou un autre verrou a pris le relais : celui-ci ne sert plus.
    if (jeton !== jetonVerrou || verrou || !$('dlg-code').open) { v.release().catch(() => {}); return; }
    verrou = v;
    v.addEventListener('release', () => { if (verrou === v) verrou = null; });
  } catch (e) { /* non supporté ou refusé */ }
}
// Chrome libère le verrou quand la page passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('dlg-code').open && !verrou) verrouillerEcran();
});

async function ouvrir(c) {
  ouverte = c;
  $('code-nom').textContent = c.nom;
  $('code-num').textContent = c.code;
  $('dlg-code').showModal();
  // L'usage est compté tout de suite ; le code s'affiche sans attendre le verrou d'écran.
  c.dernier = Date.now();
  c.usages += 1;
  enregistrer(c).catch(() => {});
  verrouillerEcran();
  await afficherCode(c);
}
$('dlg-code').addEventListener('close', () => {
  jetonVerrou++;
  verrou?.release().catch(() => {}); verrou = null;
  afficher();
});
fermerAvec('fermer', 'dlg-code');
$('supprimer').addEventListener('click', async () => {
  if (ouverte && confirm(`Supprimer ${ouverte.nom} ?`)) {
    await retirer(ouverte.id);
    cartes = cartes.filter((x) => x.id !== ouverte.id);
    $('dlg-code').close();
  }
});

// --- Logos d'enseignes (logos/index.json) -----------------------------------
let logos = null;
let logoPropose = null; // logo proposé dans le formulaire d'ajout
async function chargerLogos() {
  if (logos) return;
  try {
    logos = await lireJson('logos/index.json');
    $('enseignes').replaceChildren(...logos.map((l) => Object.assign(document.createElement('option'), { value: l.nom })));
  } catch (e) { /* hors-ligne ou fichier absent : nouvel essai à la prochaine demande */ }
}
const trouverLogo = (nom) => {
  const n = normaliser(nom);
  return n ? logos?.find((l) => [l.nom, ...(l.alias || [])].some((v) => normaliser(v) === n)) : undefined;
};
// Logo (data URL) correspondant à un nom d'enseigne, ou null.
async function logoPour(nom) {
  const l = trouverLogo(nom);
  if (!l) return null;
  const reponse = await fetch(l.fichier);
  if (!reponse.ok) throw new Error(`${l.fichier} : ${reponse.status}`);
  const blob = await reponse.blob();
  if (l.fond) return logoSurFond(blob, l);
  // Le type est forcé : certains serveurs ne déclarent pas image/svg+xml.
  return lireFichier(l.fichier.endsWith('.svg') ? new Blob([blob], { type: 'image/svg+xml' }) : blob);
}
// Logos clairs sur transparent : fond de couleur et recadrage (l.fond, l.recadrage).
async function logoSurFond(blob, l) {
  const image = await createImageBitmap(blob);
  const [x, y, w, h] = l.recadrage || [0, 0, image.width, image.height];
  const canvas = document.createElement('canvas');
  const marge = Math.round(h * 0.3);
  canvas.width = w + 2 * marge; canvas.height = h + 2 * marge;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = l.fond;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, x, y, w, h, marge, marge, w, h);
  return canvas.toDataURL('image/png');
}
let jetonProposition = 0;
async function proposerLogo() {
  const jeton = ++jetonProposition;
  const propose = $('logo').files[0] ? null : await logoPour($('nom').value).catch(() => null);
  if (jeton !== jetonProposition) return; // une saisie plus récente a pris le relais
  logoPropose = propose;
  montrerApercu($('logo-apercu'), logoPropose);
}
// Ajoute le logo aux cartes qui n'en ont pas, d'après leur nom.
async function completerLogos() {
  await chargerLogos();
  if (!logos) return;
  let change = false;
  for (const c of cartes) {
    try {
      if (c.logo) {
        // Carte créée avant le suivi de l'origine du logo : le logo d'une enseigne connue est un logo du catalogue.
        if (!c.origineLogo && trouverLogo(c.nom)) { c.origineLogo = 'catalogue'; await enregistrer(c); }
        continue;
      }
      if (c.origineLogo === 'retire') continue;
      const nom = c.nom;
      const logo = await logoPour(nom);
      // La carte a pu être renommée ou recevoir un logo pendant l'attente.
      if (!logo || c.nom !== nom || c.logo) continue;
      Object.assign(c, { logo, origineLogo: 'catalogue' });
      await enregistrer(c);
      change = true;
    } catch (e) { /* réessai au prochain démarrage */ }
  }
  if (change) afficher();
}
$('nom').addEventListener('input', proposerLogo);
$('logo').addEventListener('change', proposerLogo);

// --- Modification d'une carte (nom et logo) ---------------------------------
$('modifier').addEventListener('click', () => {
  $('dlg-code').close();
  $('nom-edit').value = ouverte.nom;
  $('logo-edit').value = '';
  $('retirer-logo').checked = false;
  $('retirer-ligne').hidden = !ouverte.logo;
  montrerApercu($('logo-edit-apercu'), ouverte.logo);
  $('dlg-edit').showModal();
  chargerLogos();
});
fermerAvec('annuler-edit', 'dlg-edit');
$('form-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nom = $('nom-edit').value.trim();
  if (!nom) return;
  const c = ouverte;
  const fichier = $('logo-edit').files[0];
  await chargerLogos();
  c.nom = nom;
  if (fichier) {
    // Image choisie par l'utilisateur : elle prime et n'est plus jamais remplacée.
    Object.assign(c, { logo: await reduire(await lireFichier(fichier)), origineLogo: 'perso' });
  } else if ($('retirer-logo').checked) {
    Object.assign(c, { logo: null, origineLogo: 'retire' });
  } else if (c.origineLogo !== 'perso') {
    // Logo du catalogue : il suit le nouveau nom (celui de la nouvelle enseigne, ou aucun).
    const auto = await logoPour(nom).catch(() => null);
    if (auto) Object.assign(c, { logo: auto, origineLogo: 'catalogue' });
    else if (c.origineLogo === 'catalogue') { c.logo = null; delete c.origineLogo; }
  }
  await enregistrer(c);
  afficher();
  $('dlg-edit').close();
});

// --- Ajout ------------------------------------------------------------------
$('ajouter').addEventListener('click', () => {
  $('form-ajout').reset();
  $('statut').textContent = '';
  formatDetecte = null;
  logoPropose = null;
  montrerApercu($('logo-apercu'), null);
  $('dlg-ajout').showModal();
  chargerLogos();
});
fermerAvec('annuler', 'dlg-ajout');

// Applique un code détecté (photo ou caméra) au formulaire d'ajout.
function appliquerCodeDetecte(texte, format) {
  $('code').value = texte;
  formatDetecte = symbologie(format);
  $('statut').textContent = '✅ Code détecté.';
}

async function scanner(fichier) {
  $('statut').textContent = 'Analyse de l\'image…';
  try {
    if ('BarcodeDetector' in window) {
      const image = await createImageBitmap(fichier);
      const r = await new BarcodeDetector().detect(image);
      if (r.length) return appliquerCodeDetecte(r[0].rawValue, r[0].format);
    }
  } catch (e) { /* repli sur ZXing */ }
  try {
    await charger('lib/zxing.min.js');
    const url = await lireFichier(fichier);
    const r = await new ZXing.BrowserMultiFormatReader(optionsZXing()).decodeFromImageUrl(url);
    return appliquerCodeDetecte(r.getText(), ZXing.BarcodeFormat[r.getBarcodeFormat()]);
  } catch (e) {
    $('statut').textContent = 'Aucun code détecté. Réessayez avec une photo plus nette ou saisissez le numéro.';
  }
}
for (const id of ['photo-camera', 'photo-galerie']) {
  $(id).addEventListener('change', (e) => { if (e.target.files[0]) scanner(e.target.files[0]); });
}

// --- Scan en direct (caméra) ------------------------------------------------
let sessionScan = null; // session en cours : { flux, minuteur, actif }

function arreterScan() {
  if (!sessionScan) return;
  const s = sessionScan;
  sessionScan = null;
  s.actif = false;
  clearTimeout(s.minuteur);
  couperFlux(s.flux);
  $('video').srcObject = null;
}

function erreurCamera(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'La caméra n\'est pas disponible ici (HTTPS requis).';
  switch (e.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Accès à la caméra refusé. Autorisez-le dans Chrome (cadenas > Autorisations), puis réessayez.';
    case 'NotFoundError': case 'OverconstrainedError': return 'Aucune caméra trouvée.';
    case 'NotReadableError': return 'La caméra est utilisée par une autre application.';
    default: return 'Impossible de démarrer la caméra.';
  }
}

async function ouvrirCamera() {
  const flux = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  // Mise au point continue quand la caméra le permet (codes-barres plus rapides à lire).
  try {
    const piste = flux.getVideoTracks()[0];
    if (piste.getCapabilities?.().focusMode?.includes('continuous')) await piste.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch (e) { /* non supporté */ }
  return flux;
}

// Renvoie lire() : { texte, format } si un code est visible sur l'image courante de la vidéo, sinon null.
async function creerLecteur(video) {
  if ('BarcodeDetector' in window) {
    const detecteur = new BarcodeDetector();
    return async () => {
      const r = await detecteur.detect(video);
      return r.length ? { texte: r[0].rawValue, format: r[0].format } : null;
    };
  }
  await charger('lib/zxing.min.js');
  const lecteur = new ZXing.MultiFormatReader();
  lecteur.setHints(optionsZXing());
  const image = document.createElement('canvas');
  const ctx = image.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return null;
    image.width = video.videoWidth;
    image.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    try {
      const r = lecteur.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(image))));
      return { texte: r.getText(), format: ZXing.BarcodeFormat[r.getBarcodeFormat()] };
    } catch (e) { return null; } // aucun code sur cette image
  };
}

// Une lecture n'est acceptée qu'après deux résultats identiques d'affilée (évite les fausses lectures).
function confirmerLecture(accepter) {
  let dernier = null;
  let lecturesIdentiques = 0;
  return ({ texte, format }) => {
    if (!texte) return;
    lecturesIdentiques = texte === dernier ? lecturesIdentiques + 1 : 1;
    dernier = texte;
    if (lecturesIdentiques >= 2) accepter(texte, format);
  };
}

async function demarrerScan() {
  $('scan-statut').textContent = 'Démarrage de la caméra…';
  $('dlg-scan').showModal();
  const s = sessionScan = { flux: null, minuteur: null, actif: true };
  try {
    s.flux = await ouvrirCamera();
    if (!s.actif) { couperFlux(s.flux); return; } // annulé pendant l'attente
    const video = $('video');
    video.srcObject = s.flux;
    await video.play();
    $('scan-statut').textContent = 'Placez le code-barres dans le cadre.';
    const lire = await creerLecteur(video);
    if (!s.actif) return;
    const confirmer = confirmerLecture((texte, format) => {
      arreterScan();
      $('dlg-scan').close();
      navigator.vibrate?.(60);
      appliquerCodeDetecte(texte, format);
    });
    const boucle = async () => {
      if (!s.actif) return;
      try {
        const lu = await lire();
        if (lu && s.actif) confirmer(lu);
      } catch (e) { /* image pas encore prête */ }
      if (s.actif) s.minuteur = setTimeout(boucle, 200);
    };
    boucle();
  } catch (e) {
    if (s.actif) $('scan-statut').textContent = erreurCamera(e);
  }
}
$('scan-direct').addEventListener('click', demarrerScan);
fermerAvec('scan-annuler', 'dlg-scan');
$('dlg-scan').addEventListener('close', arreterScan);

$('form-ajout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fichier = $('logo').files[0];
  const logo = fichier ? await reduire(await lireFichier(fichier)) : logoPropose;
  const c = nettoyerCarte({
    id: nouvelId(), nom: $('nom').value, code: $('code').value, format: formatDetecte,
    logo, origineLogo: fichier ? 'perso' : logoPropose ? 'catalogue' : undefined, dernier: Date.now(),
  });
  if (!c) { $('statut').textContent = 'Le nom et le numéro sont obligatoires.'; return; }
  const doublon = cartes.find((x) => x.code === c.code);
  if (doublon && !confirm(`Une carte « ${doublon.nom} » a déjà ce numéro. L'ajouter quand même ?`)) return;
  await enregistrer(c);
  cartes.push(c);
  afficher();
  $('dlg-ajout').close();
});

// --- Menu : version, sauvegarde, partage ------------------------------------
// Numéro de version : celui du cache du service worker (« cartefidel-vN », voir sw.js), seule source de vérité.
async function afficherVersion() {
  let v = 'inconnue';
  try {
    const nom = (await caches.keys()).find((k) => k.startsWith('cartefidel-v'));
    if (nom) v = nom.replace('cartefidel-v', '');
  } catch (e) { /* cache indisponible */ }
  $('version').textContent = `Version ${v}`;
}
$('menu').addEventListener('click', () => {
  messageMenu('');
  afficherVersion();
  $('dlg-menu').showModal();
});
fermerAvec('menu-fermer', 'dlg-menu');

const messageMenu = (texte) => { $('menu-statut').textContent = texte; };
const nomFichier = () => `cartes-${new Date().toISOString().slice(0, 10)}.json`;
const contenuExport = () => JSON.stringify({ version: 1, cartes }, null, 1);
function telecharger(contenu = contenuExport()) {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  lien.download = nomFichier();
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}
$('exporter').addEventListener('click', () => telecharger());

// Fichier de partage allégé : sans l'historique d'usage de l'expéditeur, et sans les logos d'enseignes
// connues (retrouvés par nom à l'import ; ils pèsent l'essentiel du fichier et certains systèmes refusent
// les gros fichiers). Les logos choisis par l'utilisateur sont conservés.
function pourPartage(c) {
  const { usages, dernier, ...reste } = c;
  return c.origineLogo !== 'perso' && c.logo && trouverLogo(c.nom) ? { ...reste, logo: null } : reste;
}
const contenuPartage = () => JSON.stringify({ version: 1, cartes: cartes.map(pourPartage) });

// Partage via la feuille de partage du système (messagerie, e-mail, Drive…).
$('partager').addEventListener('click', async () => {
  if (!cartes.length) { messageMenu('Aucune carte à partager.'); return; }
  // Évite d'attendre quand la liste de logos est déjà chargée (le partage doit suivre le geste de l'utilisateur).
  if (!logos) await chargerLogos();
  const contenu = contenuPartage();
  // Chrome (Android) n'autorise le partage de fichiers que pour une liste d'extensions précise
  // (.txt oui, .json non) : le JSON est donc envoyé comme un fichier texte (« .txt »).
  const fichier = new File([contenu], nomFichier().replace(/\.json$/, '.txt'), { type: 'text/plain' });
  if (!navigator.canShare?.({ files: [fichier] })) {
    telecharger(contenu);
    messageMenu('Partage indisponible : fichier téléchargé, envoyez-le manuellement.');
    return;
  }
  try {
    await navigator.share({ files: [fichier], title: 'Mes cartes de fidélité' });
    messageMenu('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Repli : le fichier est téléchargé pour pouvoir l'envoyer à la main.
    telecharger(contenu);
    messageMenu(`Le partage a échoué (${e.name}) : fichier téléchargé, envoyez-le manuellement.`);
  }
});

// Import : vérifie chaque carte, n'écrase jamais une carte existante (même identifiant ou même numéro).
$('importer').addEventListener('change', async (e) => {
  const fichier = e.target.files[0];
  if (!fichier) return;
  try {
    if (fichier.size > TAILLE_IMPORT_MAX) throw new Error('fichier trop volumineux');
    const data = JSON.parse(await fichier.text());
    const brutes = Array.isArray(data) ? data : data?.cartes;
    if (!Array.isArray(brutes)) throw new Error('format inconnu');
    const codes = new Set(cartes.map((c) => c.code));
    const ids = new Set(cartes.map((c) => c.id));
    let ajoutees = 0;
    let presentes = 0;
    let invalides = 0;
    for (const brute of brutes) {
      const c = nettoyerCarte(brute);
      if (!c) { invalides++; continue; }
      if (codes.has(c.code) || ids.has(c.id)) { presentes++; continue; }
      await enregistrer(c);
      cartes.push(c); codes.add(c.code); ids.add(c.id);
      ajoutees++;
    }
    afficher();
    messageMenu(`✅ ${ajoutees} carte(s) importée(s)`
      + (presentes ? ` · ${presentes} déjà présente(s)` : '')
      + (invalides ? ` · ${invalides} ignorée(s) (invalide)` : ''));
    completerLogos(); // retrouve les logos retirés du fichier de partage
  } catch (err) {
    messageMenu('Fichier invalide.');
  } finally {
    e.target.value = '';
  }
});

// --- Démarrage --------------------------------------------------------------
(async () => {
  try {
    await migrer();
    cartes = (await toutes()).map(nettoyerCarte).filter(Boolean);
  } catch (e) {
    alert('Stockage indisponible : les cartes ne pourront pas être enregistrées.');
  }
  afficher();
  navigator.storage?.persist?.(); // évite la purge automatique par le navigateur
  completerLogos();
})();

if ('serviceWorker' in navigator) {
  // Mise à jour : quand une nouvelle version prend le relais, la page se recharge d'elle-même
  // (sauf à la toute première installation, ou si une fenêtre de saisie est ouverte).
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (avaitUneVersion && !document.querySelector('dialog[open]')) location.reload();
  });
  navigator.serviceWorker.register('sw.js');
}
