'use strict';

const $ = (id) => document.getElementById(id);
const ANCIENNE_CLE = 'cartefidel-cartes';

// --- Stockage (IndexedDB) ---------------------------------------------------
const baseOuverte = new Promise((ok, ko) => {
  const req = indexedDB.open('cartefidel', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('cartes', { keyPath: 'id' });
  req.onsuccess = () => ok(req.result);
  req.onerror = () => ko(req.error);
});
async function tx(mode, fn) {
  const db = await baseOuverte;
  return new Promise((ok, ko) => {
    const t = db.transaction('cartes', mode);
    const res = fn(t.objectStore('cartes'));
    t.oncomplete = () => ok(res && res.result);
    t.onerror = t.onabort = () => ko(t.error);
  });
}
const toutes = () => tx('readonly', (s) => s.getAll());
const enregistrer = (c) => tx('readwrite', (s) => s.put(c));
const retirer = (id) => tx('readwrite', (s) => s.delete(id));

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

// Formats ZXing / BarcodeDetector -> symbologies bwip-js
const BWIP = {
  EAN_13: 'ean13', ean_13: 'ean13', EAN_8: 'ean8', ean_8: 'ean8',
  UPC_A: 'upca', upc_a: 'upca', UPC_E: 'upce', upc_e: 'upce',
  CODE_128: 'code128', code_128: 'code128', CODE_39: 'code39', code_39: 'code39',
  ITF: 'interleaved2of5', itf: 'interleaved2of5', CODABAR: 'rationalizedCodabar', codabar: 'rationalizedCodabar',
  QR_CODE: 'qrcode', qr_code: 'qrcode', DATA_MATRIX: 'datamatrix', data_matrix: 'datamatrix',
  PDF_417: 'pdf417', pdf417: 'pdf417', AZTEC: 'azteccode', aztec: 'azteccode',
};
let formatDetecte = null;

// --- Liste ------------------------------------------------------------------
let cartes = [];

function afficher() {
  const filtre = $('recherche').value.trim().toLowerCase();
  $('recherche').hidden = cartes.length < 6;
  $('vide').hidden = cartes.length > 0;
  const g = $('grille');
  g.replaceChildren();
  const liste = cartes
    .filter((c) => c.nom.toLowerCase().includes(filtre))
    .sort((a, b) => (b.usages || 0) - (a.usages || 0) || (b.dernier || 0) - (a.dernier || 0));
  for (const c of liste) {
    const b = document.createElement('button');
    b.className = 'carte';
    b.type = 'button';
    if (c.logo) {
      const img = document.createElement('img');
      img.src = c.logo; img.alt = c.nom;
      b.append(img);
    } else {
      b.textContent = c.nom;
    }
    b.addEventListener('click', () => ouvrir(c));
    g.append(b);
  }
}
$('recherche').addEventListener('input', afficher);

// --- Affichage d'un code ----------------------------------------------------
async function dessiner(canvas, c) {
  await charger('lib/bwip-js-min.js');
  const types = c.mode === 'qrcode'
    ? ['qrcode']
    : [c.format, /^\d{13}$/.test(c.code) ? 'ean13' : null, 'code128', 'qrcode'];
  for (const t of types) {
    if (!t) continue;
    try {
      bwipjs.toCanvas(canvas, { bcid: t, text: c.code, scale: t === 'qrcode' ? 6 : 4, height: 18, includetext: false, paddingwidth: 8, paddingheight: 8 });
      return;
    } catch (e) { /* format suivant */ }
  }
}

// Bascule code-barres / QR code (choix mémorisé par carte).
async function afficherCode(c) {
  const qr = c.mode === 'qrcode';
  $('mode-barres').setAttribute('aria-pressed', String(!qr));
  $('mode-qr').setAttribute('aria-pressed', String(qr));
  $('canvas-code').classList.toggle('qr', qr);
  await dessiner($('canvas-code'), c);
}
for (const [id, mode] of [['mode-barres', undefined], ['mode-qr', 'qrcode']]) {
  $(id).addEventListener('click', async () => {
    if (!ouverte || ouverte.mode === mode) return;
    ouverte.mode = mode;
    await afficherCode(ouverte);
    enregistrer(ouverte);
  });
}

let ouverte = null;
let verrou = null;
async function ouvrir(c) {
  ouverte = c;
  $('code-nom').textContent = c.nom;
  $('code-num').textContent = c.code;
  $('dlg-code').showModal();
  // Garde l'écran allumé pendant le passage en caisse.
  try { verrou = await navigator.wakeLock?.request('screen'); } catch (e) { /* non supporté */ }
  await afficherCode(c);
  c.dernier = Date.now();
  c.usages = (c.usages || 0) + 1;
  enregistrer(c);
}
$('dlg-code').addEventListener('close', () => {
  verrou?.release().catch(() => {}); verrou = null;
  afficher();
});
$('fermer').addEventListener('click', () => $('dlg-code').close());
$('supprimer').addEventListener('click', async () => {
  if (ouverte && confirm(`Supprimer ${ouverte.nom} ?`)) {
    await retirer(ouverte.id);
    cartes = cartes.filter((x) => x.id !== ouverte.id);
    $('dlg-code').close();
  }
});

// --- Modification du nom ---------------------------------------------------
$('modifier').addEventListener('click', () => {
  $('dlg-code').close();
  $('nom-edit').value = ouverte.nom;
  $('dlg-edit').showModal();
  chargerLogos();
});
$('annuler-edit').addEventListener('click', () => $('dlg-edit').close());
$('form-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nom = $('nom-edit').value.trim();
  if (!nom) return;
  await chargerLogos();
  ouverte.nom = nom;
  if (!ouverte.logo) ouverte.logo = await logoPour(nom);
  await enregistrer(ouverte);
  afficher();
  $('dlg-edit').close();
});

// --- Logos d'enseignes (logos/index.json) -----------------------------------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
let logos = null;
let logoAuto = null;
async function chargerLogos() {
  if (logos) return;
  try {
    logos = await (await fetch('logos/index.json')).json();
    $('enseignes').replaceChildren(...logos.map((l) => Object.assign(document.createElement('option'), { value: l.nom })));
  } catch (e) { logos = []; }
}
// Logo (data URL) correspondant à un nom d'enseigne, ou null.
async function logoPour(nom) {
  const n = norm(nom);
  const l = n && logos?.find((x) => [x.nom, ...x.alias].some((v) => norm(v) === n));
  if (!l) return null;
  const blob = await (await fetch(l.fichier)).blob();
  if (l.fond) return logoSurFond(blob, l);
  // Le type est forcé : certains serveurs ne déclarent pas image/svg+xml.
  return lireFichier(l.fichier.endsWith('.svg') ? new Blob([blob], { type: 'image/svg+xml' }) : blob);
}
// Logos clairs sur transparent : fond de couleur et recadrage (l.fond, l.recadrage).
async function logoSurFond(blob, l) {
  const bmp = await createImageBitmap(blob);
  const [x, y, w, h] = l.recadrage || [0, 0, bmp.width, bmp.height];
  const cv = document.createElement('canvas');
  const marge = Math.round(h * 0.3);
  cv.width = w + 2 * marge; cv.height = h + 2 * marge;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = l.fond;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, x, y, w, h, marge, marge, w, h);
  return cv.toDataURL('image/png');
}
async function proposerLogo() {
  logoAuto = $('logo').files[0] ? null : await logoPour($('nom').value);
  $('logo-apercu').hidden = !logoAuto;
  if (logoAuto) $('logo-apercu').src = logoAuto;
}
// Ajoute le logo aux cartes qui n'en ont pas, d'après leur nom.
async function completerLogos() {
  await chargerLogos();
  let change = false;
  for (const c of cartes) {
    if (c.logo) continue;
    try {
      const logo = await logoPour(c.nom);
      if (!logo) continue;
      c.logo = logo;
      await enregistrer(c);
      change = true;
    } catch (e) { /* réessai au prochain démarrage */ }
  }
  if (change) afficher();
}
$('nom').addEventListener('input', proposerLogo);
$('logo').addEventListener('change', proposerLogo);

// --- Ajout ------------------------------------------------------------------
$('ajouter').addEventListener('click', () => {
  $('form-ajout').reset();
  $('statut').textContent = '';
  formatDetecte = null;
  logoAuto = null;
  $('logo-apercu').hidden = true;
  $('dlg-ajout').showModal();
  chargerLogos();
});
$('annuler').addEventListener('click', () => $('dlg-ajout').close());

const lireFichier = (f) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(r.result); r.onerror = ko;
  r.readAsDataURL(f);
});

// Réduit l'image pour le stockage local
function reduire(url, max = 300) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      ok(cv.toDataURL('image/png'));
    };
    img.onerror = () => ok(url);
    img.src = url;
  });
}

async function scanner(fichier) {
  $('statut').textContent = 'Analyse de l\'image…';
  try {
    if ('BarcodeDetector' in window) {
      const bmp = await createImageBitmap(fichier);
      const r = await new BarcodeDetector().detect(bmp);
      if (r.length) return fin(r[0].rawValue, r[0].format);
    }
  } catch (e) { /* repli sur ZXing */ }
  try {
    await charger('lib/zxing.min.js');
    const url = await lireFichier(fichier);
    const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
    const r = await new ZXing.BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
    return fin(r.getText(), ZXing.BarcodeFormat[r.getBarcodeFormat()]);
  } catch (e) {
    $('statut').textContent = 'Aucun code détecté. Réessayez avec une photo plus nette ou saisissez le numéro.';
  }
}
function fin(texte, format) {
  $('code').value = texte;
  formatDetecte = BWIP[format] || null;
  $('statut').textContent = '✅ Code détecté.';
}
for (const id of ['photo-camera', 'photo-galerie']) {
  $(id).addEventListener('change', (e) => { if (e.target.files[0]) scanner(e.target.files[0]); });
}

$('form-ajout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('logo').files[0];
  const logo = f ? await reduire(await lireFichier(f)) : logoAuto;
  const c = { id: Date.now().toString(36), nom: $('nom').value.trim(), code: $('code').value.trim(), format: formatDetecte, logo, dernier: Date.now() };
  await enregistrer(c);
  cartes.push(c);
  afficher();
  $('dlg-ajout').close();
});

// --- Export / import --------------------------------------------------------
$('menu').addEventListener('click', () => { $('menu-statut').textContent = ''; $('dlg-menu').showModal(); });
$('menu-fermer').addEventListener('click', () => $('dlg-menu').close());
const nomFichier = () => `cartes-${new Date().toISOString().slice(0, 10)}.json`;
const contenuExport = () => JSON.stringify({ version: 1, cartes }, null, 1);
function telecharger(contenu = contenuExport()) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  a.download = nomFichier();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('exporter').addEventListener('click', () => telecharger());

// Partage via la feuille de partage du système (messagerie, e-mail, Drive…).
// Fichier de partage allégé : les logos d'enseignes connues sont retrouvés par nom à l'import,
// inutile de les embarquer (ils pèsent l'essentiel du fichier, et certains systèmes refusent les gros fichiers).
const logoConnu = (nom) => !!logos?.some((l) => [l.nom, ...l.alias].some((v) => norm(v) === norm(nom)));
const contenuPartage = () => JSON.stringify({
  version: 1,
  cartes: cartes.map((c) => (c.logo && logoConnu(c.nom) ? { ...c, logo: null } : c)),
});
$('partager').addEventListener('click', async () => {
  if (!cartes.length) { $('menu-statut').textContent = 'Aucune carte à partager.'; return; }
  // Évite d'attendre quand la liste de logos est déjà chargée (le partage doit suivre le geste de l'utilisateur).
  if (!logos) await chargerLogos();
  const contenu = contenuPartage();
  // Chrome (Android) n'autorise le partage de fichiers que pour une liste d'extensions précise
  // (.txt oui, .json non) : le JSON est donc envoyé comme un fichier texte (« .txt »).
  const fichier = new File([contenu], nomFichier().replace(/\.json$/, '.txt'), { type: 'text/plain' });
  if (!navigator.canShare?.({ files: [fichier] })) {
    telecharger(contenu);
    $('menu-statut').textContent = 'Partage indisponible : fichier téléchargé, envoyez-le manuellement.';
    return;
  }
  try {
    await navigator.share({ files: [fichier], title: 'Mes cartes de fidélité' });
    $('menu-statut').textContent = '';
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Repli : le fichier est téléchargé pour pouvoir l'envoyer à la main.
    telecharger(contenu);
    $('menu-statut').textContent = `Le partage a échoué (${e.name}) : fichier téléchargé, envoyez-le manuellement.`;
  }
});
$('importer').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const liste = (Array.isArray(data) ? data : data.cartes).filter((c) => c && c.id && c.nom && c.code);
    for (const c of liste) {
      await enregistrer(c);
      cartes = cartes.filter((x) => x.id !== c.id).concat(c);
    }
    afficher();
    $('menu-statut').textContent = `✅ ${liste.length} carte(s) importée(s).`;
    completerLogos(); // retrouve les logos retirés du fichier de partage
  } catch (err) {
    $('menu-statut').textContent = 'Fichier invalide.';
  }
  e.target.value = '';
});

// --- Démarrage --------------------------------------------------------------
(async () => {
  try {
    await migrer();
    cartes = await toutes();
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
