'use strict';

const CLE = 'cartefidel';
let etat = { seuil: 10, recompense: 'Un article offert', clients: [] };

try {
  etat = Object.assign(etat, JSON.parse(localStorage.getItem(CLE)) || {});
} catch (e) { /* stockage indisponible ou corrompu */ }

const sauver = () => {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { /* ignoré */ }
};

const $ = (id) => document.getElementById(id);

function afficher() {
  const filtre = $('recherche').value.trim().toLowerCase();
  const liste = $('liste');
  liste.replaceChildren();
  const clients = etat.clients.filter((c) => c.nom.toLowerCase().includes(filtre));
  $('vide').hidden = clients.length > 0;

  for (const c of clients) {
    const li = document.createElement('li');

    const entete = document.createElement('div');
    entete.className = 'entete';
    const nom = document.createElement('strong');
    nom.textContent = c.nom;
    const compteur = document.createElement('span');
    compteur.textContent = `${c.tampons} / ${etat.seuil}`;
    entete.append(nom, compteur);

    const grille = document.createElement('div');
    grille.className = 'tampons';
    for (let i = 0; i < etat.seuil; i++) {
      const t = document.createElement('span');
      t.className = 'tampon' + (i < c.tampons ? ' plein' : '');
      grille.append(t);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const pret = c.tampons >= etat.seuil;
    actions.append(
      bouton('+ Tampon', () => { c.tampons++; sauver(); afficher(); }),
      bouton('− Tampon', () => { c.tampons = Math.max(0, c.tampons - 1); sauver(); afficher(); }, 'secondaire', c.tampons === 0),
      bouton('Récompenser', () => {
        c.tampons -= etat.seuil; c.recompenses++; sauver(); afficher();
      }, '', !pret),
      bouton('Supprimer', () => {
        if (confirm(`Supprimer ${c.nom} ?`)) {
          etat.clients = etat.clients.filter((x) => x.id !== c.id); sauver(); afficher();
        }
      }, 'secondaire')
    );

    li.append(entete, grille);
    if (pret) {
      const p = document.createElement('p');
      p.className = 'pret';
      p.textContent = `Récompense disponible : ${etat.recompense}`;
      li.append(p);
    }
    const info = document.createElement('small');
    info.textContent = `Récompenses obtenues : ${c.recompenses}`;
    li.append(actions, info);
    liste.append(li);
  }
}

function bouton(texte, action, classe = '', desactive = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texte;
  if (classe) b.className = classe;
  b.disabled = desactive;
  b.addEventListener('click', action);
  return b;
}

$('form-client').addEventListener('submit', (e) => {
  e.preventDefault();
  const nom = $('nom').value.trim();
  if (!nom) return;
  etat.clients.push({ id: Date.now().toString(36), nom, tampons: 0, recompenses: 0 });
  $('nom').value = '';
  sauver();
  afficher();
});

$('seuil').value = etat.seuil;
$('recompense').value = etat.recompense;
$('seuil').addEventListener('change', () => {
  etat.seuil = Math.max(1, parseInt($('seuil').value, 10) || 1);
  $('seuil').value = etat.seuil;
  sauver(); afficher();
});
$('recompense').addEventListener('change', () => {
  etat.recompense = $('recompense').value.trim() || 'Récompense';
  sauver(); afficher();
});
$('recherche').addEventListener('input', afficher);

afficher();
