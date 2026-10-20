'use strict';

const CLE = 'cartefidel-cartes';
let cartes = [];
try { cartes = JSON.parse(localStorage.getItem(CLE)) || []; } catch (e) { /* ignoré */ }

const sauver = () => {
  try { localStorage.setItem(CLE, JSON.stringify(cartes)); }
  catch (e) { alert('Stockage plein : impossible d\'enregistrer.'); }
};
const $ = (id) => document.getElementById(id);

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
let enEdition = null;

function afficher() {
  const g = $('grille');
  g.replaceChildren();
  $('vide').hidden = cartes.length > 0;
  for (const c of cartes) {
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

function dessiner(canvas, c) {
  const types = [c.format, /^\d{13}$/.test(c.code) ? 'ean13' : null, 'code128', 'qrcode'];
  for (const t of types) {
    if (!t) continue;
    try {
      bwipjs.toCanvas(canvas, { bcid: t, text: c.code, scale: 3, height: 15, includetext: false, paddingwidth: 8, paddingheight: 8 });
      return;
    } catch (e) { /* format suivant */ }
  }
}

let ouverte = null;
function ouvrir(c) {
  ouverte = c;
  $('code-nom').textContent = c.nom;
  $('code-num').textContent = c.code;
  dessiner($('canvas-code'), c);
  $('dlg-code').showModal();
}
$('fermer').addEventListener('click', () => $('dlg-code').close());
$('supprimer').addEventListener('click', () => {
  if (ouverte && confirm(`Supprimer ${ouverte.nom} ?`)) {
    cartes = cartes.filter((x) => x.id !== ouverte.id);
    sauver(); afficher(); $('dlg-code').close();
  }
});

function ouvrirFormulaire(c) {
  enEdition = c || null;
  $('form-ajout').reset();
  $('statut').textContent = '';
  $('titre-ajout').textContent = c ? 'Modifier la carte' : 'Nouvelle carte';
  $('ligne-retirer-logo').hidden = !(c && c.logo);
  formatDetecte = c ? c.format : null;
  if (c) { $('nom').value = c.nom; $('code').value = c.code; }
  $('dlg-ajout').showModal();
}
$('ajouter').addEventListener('click', () => ouvrirFormulaire(null));
$('modifier').addEventListener('click', () => {
  const c = ouverte;
  $('dlg-code').close();
  ouvrirFormulaire(c);
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
  const url = await lireFichier(fichier);
  try {
    if ('BarcodeDetector' in window) {
      const bmp = await createImageBitmap(fichier);
      const r = await new BarcodeDetector().detect(bmp);
      if (r.length) { return fin(r[0].rawValue, r[0].format); }
    }
  } catch (e) { /* repli sur ZXing */ }
  try {
    const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
    const lecteur = new ZXing.BrowserMultiFormatReader(hints);
    const r = await lecteur.decodeFromImageUrl(url);
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
  const nom = $('nom').value.trim();
  const code = $('code').value.trim();
  if (enEdition) {
    if (code !== enEdition.code && formatDetecte === enEdition.format) formatDetecte = null;
    enEdition.nom = nom; enEdition.code = code; enEdition.format = formatDetecte;
    if (f) enEdition.logo = await reduire(await lireFichier(f));
    else if ($('retirer-logo').checked) enEdition.logo = null;
  } else {
    const logo = f ? await reduire(await lireFichier(f)) : null;
    cartes.push({ id: Date.now().toString(36), nom, code, format: formatDetecte, logo });
  }
  sauver(); afficher();
  $('dlg-ajout').close();
});

afficher();
