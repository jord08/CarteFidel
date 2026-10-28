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
    .sort((a, b) => (b.dernier || 0) - (a.dernier || 0));
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
  const types = [c.format, /^\d{13}$/.test(c.code) ? 'ean13' : null, 'code128', 'qrcode'];
  for (const t of types) {
    if (!t) continue;
    try {
      bwipjs.toCanvas(canvas, { bcid: t, text: c.code, scale: 4, height: 18, includetext: false, paddingwidth: 8, paddingheight: 8 });
      return;
    } catch (e) { /* format suivant */ }
  }
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
  await dessiner($('canvas-code'), c);
  c.dernier = Date.now();
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
async function proposerLogo() {
  logoAuto = null;
  const n = norm($('nom').value);
  const l = n && logos?.find((x) => [x.nom, ...x.alias].some((v) => norm(v) === n));
  if (l && !$('logo').files[0]) {
    const svg = await (await fetch(l.fichier)).text();
    logoAuto = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  $('logo-apercu').hidden = !logoAuto;
  if (logoAuto) $('logo-apercu').src = logoAuto;
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
$('exporter').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, cartes }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cartes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
