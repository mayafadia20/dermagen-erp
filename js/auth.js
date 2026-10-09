// Comptes utilisateurs et connexion. Les comptes vivent dans la base locale (collection « users ») ;
// les mots de passe sont stockés sous forme d'empreinte PBKDF2-SHA-256 (150 000 itérations, sel aléatoire).
// La session est conservée dans sessionStorage (ou localStorage avec « Se souvenir de moi »).
import { db } from './store.js';
import { esc, toast } from './ui.js';

export const ROLES = [['admin', 'Administrateur·rice'], ['formulatrice', 'Formulateur·rice'], ['lecture', 'Lecture seule']];
export const roleLabel = (r) => (ROLES.find(x => x[0] === r) || [r, r])[1];
const COLORS = ['#8d7bf0', '#f06b9c', '#3b9ddd', '#2f9e6b', '#e0903b', '#8a5cf5', '#d64545', '#2bb3b1'];
const SESSION_KEY = 'dermagen-session';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256);
  return { salt: b64(salt), hash: b64(bits) };
}
export async function verifyPassword(user, password) {
  if (!user?.hash || !user?.salt) return false;
  const { hash } = await hashPassword(password, user.salt);
  return hash === user.hash;
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export const pickColor = () => COLORS[db.all('users').length % COLORS.length];
export const findByEmail = (email) => db.all('users').find(u => u.email.toLowerCase() === String(email || '').trim().toLowerCase());

let current = null;
export function currentUser() { return current; }
export function isAdmin() { return current?.role === 'admin'; }
export function isReadOnly() { return current?.role === 'lecture'; }

export async function createUser({ name, email, password, role = 'formulatrice', color }) {
  if (!name?.trim() || !email?.trim()) throw new Error('Nom et courriel sont obligatoires.');
  if (!password || password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  if (findByEmail(email)) throw new Error('Un compte existe déjà avec ce courriel.');
  const { salt, hash } = await hashPassword(password);
  return db.insert('users', { name: name.trim(), email: email.trim().toLowerCase(), role, color: color || pickColor(), salt, hash, mustChange: false });
}
export async function setPassword(userId, password, { mustChange = false } = {}) {
  if (!password || password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  const { salt, hash } = await hashPassword(password);
  db.update('users', userId, { salt, hash, mustChange });
}

function saveSession(id, remember) {
  try { sessionStorage.setItem(SESSION_KEY, id); if (remember) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); } catch (_) {}
}
function readSession() { try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch (_) { return null; } }

export function logout() {
  current = null;
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (_) {}
  location.hash = '#/dashboard';
  location.reload();
}

/** Affiche l'écran de connexion (ou de création du premier compte) et résout avec l'utilisateur connecté. */
export function requireLogin() {
  const saved = readSession();
  if (saved) { const u = db.get('users', saved); if (u) { current = u; db.update('users', u.id, { lastLoginAt: new Date().toISOString() }); return Promise.resolve(u); } }
  return new Promise(resolve => {
    const first = !db.all('users').length;
    const el = document.createElement('div');
    el.id = 'login';
    el.innerHTML = `
      <div class="login-card">
        <img src="assets/logo-violet.png" alt="DermaGen" class="login-logo">
        <h1>${first ? 'Bienvenue dans l’ERP DermaGen' : 'Connexion'}</h1>
        <p class="muted">${first ? 'Aucun compte n’existe encore. Créez le compte administrateur pour commencer.' : 'Entrez vos identifiants pour accéder à votre espace.'}</p>
        <form data-login novalidate>
          ${first ? `
            <label>Votre nom<input name="name" autocomplete="name" placeholder="ex. Maya Lounici" required></label>
            <label>Courriel<input name="email" type="email" autocomplete="username" placeholder="vous@dermagen.ca" required></label>
            <label>Mot de passe<input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
            <label>Confirmer le mot de passe<input name="confirm" type="password" autocomplete="new-password" minlength="6" required></label>
          ` : `
            <label>Courriel<input name="email" type="email" autocomplete="username" placeholder="vous@dermagen.ca" required autofocus></label>
            <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
            <label class="login-remember"><input type="checkbox" name="remember"> Se souvenir de moi sur cet appareil</label>
          `}
          <div class="login-error" data-error hidden></div>
          <button type="submit" class="btn primary login-submit">${first ? 'Créer mon compte et entrer' : 'Se connecter'}</button>
        </form>
        <p class="muted login-foot">${first ? 'Vous pourrez ensuite ajouter d’autres utilisateurs depuis votre profil.' : 'Mot de passe oublié ? Un·e administrateur·rice peut le réinitialiser depuis son profil.'}</p>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('login-open');
    const form = el.querySelector('[data-login]'), err = el.querySelector('[data-error]');
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const f = form.elements;
      try {
        if (!crypto?.subtle) throw new Error('Le navigateur exige une connexion sécurisée (https) pour la connexion.');
        let user;
        if (first) {
          if (f.password.value !== f.confirm.value) throw new Error('Les deux mots de passe ne correspondent pas.');
          user = await createUser({ name: f.name.value, email: f.email.value, password: f.password.value, role: 'admin' });
        } else {
          user = findByEmail(f.email.value);
          if (!user || !await verifyPassword(user, f.password.value)) throw new Error('Courriel ou mot de passe incorrect.');
        }
        current = db.update('users', user.id, { lastLoginAt: new Date().toISOString() });
        saveSession(user.id, first ? true : f.remember.checked);
        el.classList.add('out');
        setTimeout(() => { el.remove(); document.body.classList.remove('login-open'); }, 350);
        resolve(current);
      } catch (ex) { fail(ex.message || 'Erreur'); }
    });
    setTimeout(() => form.querySelector('input')?.focus(), 50);
  });
}

/** Compte en lecture seule : bloque toute modification sauf le profil de la personne elle-même et ses discussions. */
export function installReadOnlyGuard() {
  if (!isReadOnly()) return;
  const allowed = (col, id) => col === 'chats' || (col === 'users' && id === current.id);
  const block = () => { toast('Compte en lecture seule : modification impossible.', 'warn'); throw new Error('Compte en lecture seule : modification impossible.'); };
  const insert = db.insert.bind(db), update = db.update.bind(db), remove = db.remove.bind(db), save = db.saveSettings.bind(db);
  db.insert = (col, obj) => allowed(col) ? insert(col, obj) : block();
  db.update = (col, id, patch) => allowed(col, id) ? update(col, id, patch) : block();
  db.remove = (col, id) => allowed(col, id) ? remove(col, id) : block();
  db.saveSettings = () => block();
}

export function avatarHtml(u, cls = 'topbar-avatar') { return `<span class="${cls}" style="background:${esc(u?.color || '#8d7bf0')}" title="${esc(u?.name || '')}">${esc(initials(u?.name))}</span>`; }
