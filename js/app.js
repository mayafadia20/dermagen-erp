// Point d'entrée : navigation, routage par hash, montage des modules.
import { db } from './store.js';
import { esc, toast } from './ui.js';
import dashboard from './modules/dashboard.js';
import ingredients from './modules/ingredients.js';
import formulations from './modules/formulations.js';
import suppliers from './modules/suppliers.js';
import purchases from './modules/purchases.js';
import invoices from './modules/invoices.js';
import payments from './modules/payments.js';
import settings from './modules/settings.js';
import passwords from './modules/passwords.js';
import accelerators from './modules/accelerators.js';
import chat from './modules/chat.js';
import profile from './modules/profile.js';
import { requireLogin, currentUser, firstName, initials, logout, installReadOnlyGuard, isAdmin } from './auth.js';

const MODULES = { dashboard, ingredients, formulations, chat, suppliers, purchases, invoices, payments, passwords, accelerators, profile, settings };

const NAV = [
  { group: 'Vue d’ensemble' },
  { id: 'dashboard', label: 'Tableau de bord', icon: '◫' },
  { group: 'Laboratoire' },
  { id: 'ingredients', label: 'Inventaire des ingrédients', icon: '⚗' },
  { id: 'formulations', label: 'Formulations', icon: '✦' },
  { id: 'chat', label: 'Assistante chimiste', icon: '⚗' },
  { group: 'Approvisionnement' },
  { id: 'suppliers', label: 'Fournisseurs', icon: '⌂' },
  { id: 'purchases', label: 'Bons de commande', icon: '▤' },
  { group: 'Finances' },
  { id: 'invoices', label: 'Factures', icon: '▦' },
  { id: 'payments', label: 'Paiements', icon: '◈' },
  { group: 'Entreprise' },
  { id: 'accelerators', label: 'Demandes d’accélérateurs', icon: '➚' },
  { id: 'passwords', label: 'Mots de passe & accès', icon: '⚿' },
  { group: 'Compte' },
  { id: 'profile', label: 'Mon profil', icon: '◉' },
  { id: 'settings', label: 'Paramètres & sauvegarde', icon: '⚙', admin: true },
];

const $ = (s, r = document) => r.querySelector(s);

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [view = 'dashboard', id = ''] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { view: MODULES[view] ? view : 'dashboard', id, params };
}

export function navigate(view, id = '', params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = '#/' + view + (id ? '/' + id : '') + (q ? '?' + q : '');
}

function renderNav(active) {
  $('#nav').innerHTML = NAV.filter(n => !n.admin || isAdmin()).map(n => n.group
    ? `<div class="nav-group">${esc(n.group)}</div>`
    : `<a href="#/${n.id}" class="nav-item ${n.id === active ? 'active' : ''}"><span class="nav-icon">${n.icon}</span><span>${esc(n.label)}</span></a>`
  ).join('');
}

let current = null;
function render() {
  const route = parseHash();
  if (route.view === 'settings' && !isAdmin()) route.view = 'profile';
  current = route;
  renderNav(route.view);
  const mod = MODULES[route.view];
  const main = $('#main');
  document.title = `${mod.title} · DermaGen ERP`;
  $('#topbar-title').textContent = mod.title;
  // Conteneur neuf à chaque rendu : évite l'accumulation d'écouteurs d'événements entre les vues.
  main.innerHTML = '';
  const view = document.createElement('div');
  view.className = 'view';
  main.appendChild(view);
  try {
    mod.render(view, { ...route, navigate });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>Erreur d’affichage</h2><pre>${esc(e.stack || e.message)}</pre></div>`;
  }
  $('#sidebar').classList.remove('open');
  window.scrollTo(0, 0);
}

function paintUser() {
  const u = currentUser(); if (!u) return;
  const av = $('#topbar-avatar');
  av.textContent = initials(u.name); av.style.background = u.color || ''; av.title = u.name;
  $('#topbar-user-name').textContent = u.name;
}

async function boot() {
  await db.init();
  $('#splash').remove();
  await requireLogin();
  installReadOnlyGuard();
  paintUser();
  document.addEventListener('user-changed', paintUser);
  $('#topbar-avatar').addEventListener('click', e => { e.stopPropagation(); $('#user-menu').classList.toggle('open'); });
  document.addEventListener('click', () => $('#user-menu').classList.remove('open'));
  $('#user-logout').addEventListener('click', logout);
  window.addEventListener('hashchange', render);
  let dirty = false;
  db.on((col) => {
    if (col === 'chats' && current && current.view === 'chat') return;   // la discussion gère son propre affichage pendant une réponse
    if (col === 'recipes' && current && current.view === 'formulations' && (current.id || '').startsWith('fiche-')) return;   // la fiche mémorise sa recommandation sans se re-rendre
    if (document.body.classList.contains('modal-open')) dirty = true; else render();
  });
  document.addEventListener('modal-closed', () => { if (dirty && !document.body.classList.contains('modal-open')) { dirty = false; render(); } });
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#global-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { navigate('ingredients', '', { q: e.target.value }); }
  });
  const h = new Date().getHours();
  const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  $('#topbar-greeting').textContent = hello + (currentUser() ? ' ' + firstName(currentUser().name) : '') + ' · ' + (d => d[0].toUpperCase() + d.slice(1))(new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }));
  render();
}

boot().catch(e => {
  console.error(e);
  toast('Impossible de démarrer l’application : ' + e.message, 'err');
});
