// Comptes utilisateurs et connexion.
// Mode en ligne (Supabase configuré) : comptes Supabase Auth (courriel + mot de passe), profils dans la
// collection « users » (rôle, couleur), sessions gérées par Supabase.
// Mode local (sans Supabase) : comptes dans la base locale avec empreintes PBKDF2-SHA-256.
import { db } from './store.js';
import { esc, toast } from './ui.js';
import { cloud } from './cloud.js';

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
  if (cloud.enabled()) { try { await cloud.signIn(user.email, password); return true; } catch (_) { return false; } }
  if (!user?.hash || !user?.salt) return false;
  const { hash } = await hashPassword(password, user.salt);
  return hash === user.hash;
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export const pickColor = () => COLORS[db.all('users').length % COLORS.length];
export const findByEmail = (email) => db.all('users').find(u => u.email.toLowerCase() === String(email || '').trim().toLowerCase());
export const isCloud = () => cloud.enabled();

let current = null;
export function currentUser() { return current; }
export function isAdmin() { return current?.role === 'admin'; }
export function isReadOnly() { return current?.role === 'lecture'; }

/** Crée un compte. En ligne : compte Supabase Auth (sans toucher à la session en cours) + profil. */
export async function createUser({ name, email, password, role = 'formulatrice', color }) {
  if (!name?.trim() || !email?.trim()) throw new Error('Nom et courriel sont obligatoires.');
  if (!password || password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  if (findByEmail(email)) throw new Error('Un compte existe déjà avec ce courriel.');
  const base = { name: name.trim(), email: email.trim().toLowerCase(), role, color: color || pickColor() };
  if (cloud.enabled()) {
    const { user } = await cloud.signUpOther(base.email, password, { name: base.name });
    if (!user?.id) throw new Error('Supabase n’a pas renvoyé d’identifiant de compte.');
    return db.insert('users', { ...base, id: user.id, authProvider: 'supabase' });
  }
  const { salt, hash } = await hashPassword(password);
  return db.insert('users', { ...base, salt, hash, mustChange: false });
}
export async function setPassword(userId, password, { mustChange = false } = {}) {
  if (!password || password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
  if (cloud.enabled()) {
    if (userId !== current?.id) throw new Error('En ligne, seule la personne peut changer son mot de passe ; envoyez-lui un courriel de réinitialisation.');
    await cloud.updatePassword(password); return;
  }
  const { salt, hash } = await hashPassword(password);
  db.update('users', userId, { salt, hash, mustChange });
}
export async function sendResetEmail(email) { if (!cloud.enabled()) throw new Error('Disponible en mode en ligne seulement.'); await cloud.resetPassword(email); }

function saveSession(id, remember) {
  try { sessionStorage.setItem(SESSION_KEY, id); if (remember) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); } catch (_) {}
}
function readSession() { try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch (_) { return null; } }

export async function logout() {
  current = null;
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (_) {}
  if (cloud.enabled()) { try { await cloud.signOut(); } catch (_) {} }
  location.hash = '#/dashboard';
  location.reload();
}

// ---------- Écran de connexion ----------
function mount(html) {
  const el = document.createElement('div'); el.id = 'login'; el.innerHTML = html;
  document.body.appendChild(el); document.body.classList.add('login-open');
  return el;
}
function unmount(el) { el.classList.add('out'); setTimeout(() => { el.remove(); document.body.classList.remove('login-open'); }, 350); }

/** Affiche l'écran de connexion (ou de création du premier compte) et résout avec l'utilisateur connecté. */
export function requireLogin() {
  return cloud.enabled() ? requireLoginCloud() : requireLoginLocal();
}

// ----- Mode local -----
function requireLoginLocal() {
  const saved = readSession();
  if (saved) { const u = db.get('users', saved); if (u) { current = u; db.update('users', u.id, { lastLoginAt: new Date().toISOString() }); return Promise.resolve(u); } }
  return new Promise(resolve => {
    const first = !db.all('users').length;
    const el = mount(`
      <div class="login-card">
        <img src="assets/logo-violet.png" alt="DermaGen" class="login-logo">
        <h1>${first ? 'Bienvenue dans l’ERP DermaGen' : 'Connexion'}</h1>
        ${first ? '' : '<p class="muted">Entrez vos identifiants pour accéder à votre espace.</p>'}
        <form data-login novalidate>
          ${first ? `
            <label>Votre nom<input name="name" autocomplete="name" required></label>
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
      </div>`);
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
        unmount(el); resolve(current);
      } catch (ex) { fail(ex.message || 'Erreur'); }
    });
    setTimeout(() => form.querySelector('input')?.focus(), 50);
  });
}

// ----- Mode en ligne (Supabase) -----
async function profileFor(authUser) {
  await db.sync();
  let u = db.get('users', authUser.id) || findByEmail(authUser.email);
  if (!u) {
    const role = db.all('users').length ? 'formulatrice' : 'admin';
    u = db.insert('users', { id: authUser.id, name: authUser.user_metadata?.name || authUser.email.split('@')[0], email: authUser.email.toLowerCase(), role, color: pickColor(), authProvider: 'supabase' });
  } else if (u.id !== authUser.id) {
    // profil créé par un admin avant la première connexion : on l'aligne sur l'identifiant Supabase
    const data = { ...u, id: authUser.id, authProvider: 'supabase' };
    db.remove('users', u.id); u = db.insert('users', data);
  }
  current = db.update('users', u.id, { lastLoginAt: new Date().toISOString() }) || u;
  return current;
}

function requireLoginCloud() {
  return new Promise(async resolve => {
    const recovery = /type=recovery/.test(location.hash);
    let session = null;
    try { session = await cloud.session(); } catch (e) { console.warn(e); }
    if (session && !recovery) { try { return resolve(await profileFor(session.user)); } catch (e) { console.error(e); toast(e.message, 'err'); } }

    const view = recovery ? 'recovery' : 'login';
    const el = mount(cloudScreen(view));
    let mode = view;
    const rerender = (m) => { mode = m; el.innerHTML = cloudScreen(m); wire(); };
    const wire = () => {
      const form = el.querySelector('[data-login]'), err = el.querySelector('[data-error]'), ok = el.querySelector('[data-ok]');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      el.querySelector('[data-to-signup]')?.addEventListener('click', e => { e.preventDefault(); rerender('signup'); });
      el.querySelector('[data-to-login]')?.addEventListener('click', e => { e.preventDefault(); rerender('login'); });
      el.querySelector('[data-to-reset]')?.addEventListener('click', e => { e.preventDefault(); rerender('reset'); });
      form.addEventListener('submit', async e => {
        e.preventDefault(); err.hidden = true; if (ok) ok.hidden = true;
        const f = form.elements; const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          if (mode === 'login') {
            const user = await cloud.signIn(f.email.value.trim(), f.password.value);
            const me = await profileFor(user); unmount(el); resolve(me);
          } else if (mode === 'signup') {
            if (f.password.value !== f.confirm.value) throw new Error('Les deux mots de passe ne correspondent pas.');
            const { user, session: s } = await cloud.signUp(f.email.value.trim(), f.password.value, { name: f.name.value.trim() });
            if (s && user) { const me = await profileFor(user); unmount(el); resolve(me); }
            else { ok.textContent = 'Compte créé. Confirme ton adresse via le courriel reçu, puis connecte-toi.'; ok.hidden = false; }
          } else if (mode === 'reset') {
            await cloud.resetPassword(f.email.value.trim());
            ok.textContent = 'Courriel envoyé : suis le lien pour choisir un nouveau mot de passe.'; ok.hidden = false;
          } else if (mode === 'recovery') {
            if (f.password.value !== f.confirm.value) throw new Error('Les deux mots de passe ne correspondent pas.');
            await cloud.updatePassword(f.password.value);
            history.replaceState(null, '', location.pathname + '#/dashboard');
            const s2 = await cloud.session(); const me = await profileFor(s2.user); unmount(el); resolve(me);
          }
        } catch (ex) { fail(ex.message || 'Erreur'); }
        finally { btn.disabled = false; }
      });
      setTimeout(() => form.querySelector('input')?.focus(), 50);
    };
    wire();
  });
}

function cloudScreen(mode) {
  const head = `<img src="assets/logo-violet.png" alt="DermaGen" class="login-logo">`;
  const body = {
    login: `
      <h1>Connexion</h1><p class="muted">Entrez vos identifiants pour accéder à votre espace.</p>
      <form data-login novalidate>
        <label>Courriel<input name="email" type="email" autocomplete="username" placeholder="vous@dermagen.ca" required></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
        <div class="login-error" data-error hidden></div><div class="login-ok" data-ok hidden></div>
        <button type="submit" class="btn primary login-submit">Se connecter</button>
      </form>
      <p class="muted login-foot"><a href="#" data-to-reset>Mot de passe oublié ?</a> · <a href="#" data-to-signup>Créer un compte</a></p>`,
    signup: `
      <h1>Créer un compte</h1><p class="muted">Le premier compte créé devient administrateur ; les suivants sont formulateur·rice jusqu’à ce qu’un·e administrateur·rice change leur rôle.</p>
      <form data-login novalidate>
        <label>Votre nom<input name="name" autocomplete="name" required></label>
        <label>Courriel<input name="email" type="email" autocomplete="username" required></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
        <label>Confirmer le mot de passe<input name="confirm" type="password" autocomplete="new-password" minlength="6" required></label>
        <div class="login-error" data-error hidden></div><div class="login-ok" data-ok hidden></div>
        <button type="submit" class="btn primary login-submit">Créer mon compte</button>
      </form>
      <p class="muted login-foot"><a href="#" data-to-login>J’ai déjà un compte</a></p>`,
    reset: `
      <h1>Mot de passe oublié</h1><p class="muted">Nous t’envoyons un lien pour en choisir un nouveau.</p>
      <form data-login novalidate>
        <label>Courriel<input name="email" type="email" autocomplete="username" required></label>
        <div class="login-error" data-error hidden></div><div class="login-ok" data-ok hidden></div>
        <button type="submit" class="btn primary login-submit">Envoyer le lien</button>
      </form>
      <p class="muted login-foot"><a href="#" data-to-login>Retour à la connexion</a></p>`,
    recovery: `
      <h1>Nouveau mot de passe</h1><p class="muted">Choisis ton nouveau mot de passe.</p>
      <form data-login novalidate>
        <label>Nouveau mot de passe<input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
        <label>Confirmer<input name="confirm" type="password" autocomplete="new-password" minlength="6" required></label>
        <div class="login-error" data-error hidden></div><div class="login-ok" data-ok hidden></div>
        <button type="submit" class="btn primary login-submit">Enregistrer et entrer</button>
      </form>`,
  }[mode];
  return `<div class="login-card">${head}${body}</div>`;
}

/** Compte en lecture seule : bloque toute modification sauf le profil de la personne elle-même et ses discussions. */
export function installReadOnlyGuard() {
  if (!isReadOnly()) return;
  const allowed = (col, id) => col === 'chats' || col === 'recipes' || (col === 'users' && id === current.id);
  const block = () => { toast('Compte en lecture seule : modification impossible.', 'warn'); throw new Error('Compte en lecture seule : modification impossible.'); };
  const insert = db.insert.bind(db), update = db.update.bind(db), remove = db.remove.bind(db);
  db.insert = (col, obj) => allowed(col) ? insert(col, obj) : block();
  db.update = (col, id, patch) => allowed(col, id) ? update(col, id, patch) : block();
  db.remove = (col, id) => allowed(col, id) ? remove(col, id) : block();
  db.saveSettings = () => block();
}

export function avatarHtml(u, cls = 'topbar-avatar') { return `<span class="${cls}" style="background:${esc(u?.color || '#8d7bf0')}" title="${esc(u?.name || '')}">${esc(initials(u?.name))}</span>`; }
