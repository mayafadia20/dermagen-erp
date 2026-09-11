// Mots de passe & accès : coffre chiffré (AES-GCM, clé dérivée d'un mot de passe maître via PBKDF2).
// Les secrets ne sont jamais stockés en clair : seuls le nom, l'URL, l'identifiant et la catégorie restent lisibles.
import { db } from '../store.js';
import { esc, dateFmt, toast, badge, openModal, confirmDialog, field, table, matches, statCard } from '../ui.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const CHECK = 'dermagen-vault-ok';
const AUTOLOCK_MS = 15 * 60 * 1000;

let sessionKey = null;
let lockTimer = null;

function touch() {
  clearTimeout(lockTimer);
  if (sessionKey) lockTimer = setTimeout(() => { lock(); toast('Coffre verrouillé automatiquement (inactivité).', 'warn'); }, AUTOLOCK_MS);
}
export function lock() { sessionKey = null; clearTimeout(lockTimer); if (location.hash.startsWith('#/passwords')) window.dispatchEvent(new HashChangeEvent('hashchange')); }

async function deriveKey(master, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(master), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text || ''));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decrypt(key, blob) {
  if (!blob || !blob.ct) return '';
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return dec.decode(pt);
}
const vaultCfg = () => db.settings().vault || null;

async function createVault(master) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(master, salt);
  const check = await encrypt(key, CHECK);
  sessionKey = key; touch();
  db.saveSettings({ vault: { salt, check, createdAt: new Date().toISOString() } });
}
async function unlock(master) {
  const cfg = vaultCfg(); if (!cfg) return false;
  try {
    const key = await deriveKey(master, cfg.salt);
    if (await decrypt(key, cfg.check) !== CHECK) return false;
    sessionKey = key; touch(); return true;
  } catch { return false; }
}

export function generatePassword(len = 18) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_+=';
  const arr = crypto.getRandomValues(new Uint32Array(len));
  return [...arr].map(n => chars[n % chars.length]).join('');
}

async function copy(text, label = 'Copié') {
  try { await navigator.clipboard.writeText(text); toast(label + ' dans le presse-papiers (pensez à l’effacer).'); }
  catch { toast('Copie impossible : sélectionnez le texte manuellement.', 'err'); }
}

// ---------- Formulaire d'entrée ----------
async function openEntryForm(existing) {
  const s = db.settings();
  let password = '', secret = '';
  if (existing) { try { password = await decrypt(sessionKey, existing.password); secret = await decrypt(sessionKey, existing.secret); } catch { toast('Impossible de déchiffrer cette entrée.', 'err'); return; } }
  const e = existing || { category: s.passwordCategories[0] };
  const m = openModal({
    title: existing ? 'Modifier l’accès' : 'Nouvel accès', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'Nom du compte / service', name: 'name', value: e.name, required: true, cols: 2, placeholder: 'ex. Desjardins AccèsD, Shopify, Revenu Québec' })}
      ${field({ label: 'Catégorie', name: 'category', type: 'select', options: s.passwordCategories, value: e.category, cols: 2 })}
      ${field({ label: 'Lien (URL de connexion)', name: 'url', type: 'url', value: e.url, cols: 4, placeholder: 'https://' })}
      ${field({ label: 'Identifiant / courriel', name: 'username', value: e.username, cols: 2 })}
      <div class="field cols-2"><label>Mot de passe</label><div style="display:flex;gap:6px"><input name="password" type="text" value="${esc(password)}" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-gen title="Générer un mot de passe fort">⚄</button></div></div>
      ${field({ label: 'Informations sensibles chiffrées (NIP, réponses de sécurité, codes de secours…)', name: 'secret', type: 'textarea', rows: 3, value: secret, cols: 4 })}
      ${field({ label: 'Notes (non chiffrées)', name: 'notes', value: e.notes, cols: 4, placeholder: 'ex. Compte partagé avec la comptable' })}
    </div>`,
    async onSubmit(d) {
      const rec = { name: d.name, category: d.category, url: d.url, username: d.username, notes: d.notes, password: await encrypt(sessionKey, d.password), secret: await encrypt(sessionKey, d.secret) };
      if (existing) { db.update('passwords', existing.id, rec); toast('Accès mis à jour'); }
      else { db.insert('passwords', rec); toast('Accès enregistré'); }
      touch();
    }
  });
  m.form.querySelector('[data-gen]').addEventListener('click', () => { m.form.querySelector('[name=password]').value = generatePassword(); });
}

function openChangeMaster() {
  openModal({
    title: 'Changer le mot de passe maître',
    body: `<div class="form-grid">
      <div class="field cols-4"><div class="warnbox">Toutes les entrées seront rechiffrées avec le nouveau mot de passe. Si vous l’oubliez, les mots de passe stockés seront irrécupérables.</div></div>
      ${field({ label: 'Mot de passe maître actuel', name: 'current', type: 'password', required: true, cols: 4 })}
      ${field({ label: 'Nouveau mot de passe maître', name: 'next', type: 'password', required: true, cols: 2, help: 'Au moins 10 caractères' })}
      ${field({ label: 'Confirmer', name: 'confirm', type: 'password', required: true, cols: 2 })}
    </div>`,
    submitLabel: 'Changer',
    async onSubmit(d) {
      if (d.next.length < 10) { toast('Le nouveau mot de passe doit avoir au moins 10 caractères.', 'warn'); return false; }
      if (d.next !== d.confirm) { toast('La confirmation ne correspond pas.', 'warn'); return false; }
      const cfg = vaultCfg();
      const oldKey = await deriveKey(d.current, cfg.salt);
      try { if (await decrypt(oldKey, cfg.check) !== CHECK) throw 0; } catch { toast('Mot de passe actuel incorrect.', 'err'); return false; }
      const entries = db.all('passwords').map(p => ({ ...p }));
      const plain = [];
      for (const p of entries) plain.push({ id: p.id, password: await decrypt(oldKey, p.password), secret: await decrypt(oldKey, p.secret) });
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const newKey = await deriveKey(d.next, salt);
      for (const p of plain) db.update('passwords', p.id, { password: await encrypt(newKey, p.password), secret: await encrypt(newKey, p.secret) });
      db.saveSettings({ vault: { salt, check: await encrypt(newKey, CHECK), createdAt: cfg.createdAt, changedAt: new Date().toISOString() } });
      sessionKey = newKey; touch(); toast('Mot de passe maître changé');
    }
  });
}

// ---------- Écrans ----------
function renderSetup(el, ctx) {
  el.innerHTML = `
    <div class="card" style="max-width:620px">
      <h2>Créer le coffre de mots de passe</h2>
      <p class="muted" style="margin:8px 0 14px">Les mots de passe de l’entreprise seront chiffrés dans ce navigateur avec un <b>mot de passe maître</b> que vous seule connaissez. Il n’est stocké nulle part : si vous l’oubliez, le contenu du coffre est perdu. Notez-le dans un endroit sûr.</p>
      <form data-setup class="form-grid">
        ${field({ label: 'Mot de passe maître', name: 'master', type: 'password', required: true, cols: 2, help: 'Au moins 10 caractères, idéalement une phrase.' })}
        ${field({ label: 'Confirmer', name: 'confirm', type: 'password', required: true, cols: 2 })}
        <div class="field cols-4"><button type="submit" class="btn primary">Créer le coffre</button></div>
      </form>
    </div>`;
  el.querySelector('[data-setup]').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    if (f.master.value.length < 10) return toast('Au moins 10 caractères.', 'warn');
    if (f.master.value !== f.confirm.value) return toast('La confirmation ne correspond pas.', 'warn');
    await createVault(f.master.value); toast('Coffre créé');
    if (el.isConnected) renderList(el, ctx);
  });
}

function renderLocked(el, ctx) {
  el.innerHTML = `
    <div class="card" style="max-width:520px">
      <h2>🔒 Coffre verrouillé</h2>
      <p class="muted" style="margin:8px 0 14px">${db.all('passwords').length} accès enregistré(s). Entrez le mot de passe maître pour les consulter. Le coffre se verrouille après 15 minutes d’inactivité.</p>
      <form data-unlock class="form-grid">
        ${field({ label: 'Mot de passe maître', name: 'master', type: 'password', required: true, cols: 3 })}
        <div class="field cols-1" style="justify-content:flex-end"><button type="submit" class="btn primary">Déverrouiller</button></div>
      </form>
    </div>`;
  el.querySelector('[data-unlock]').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target; const btn = f.querySelector('button'); btn.disabled = true;
    if (await unlock(f.master.value)) { toast('Coffre déverrouillé'); renderList(el, ctx); }
    else { toast('Mot de passe maître incorrect.', 'err'); btn.disabled = false; f.master.select(); }
  });
}

function renderList(el, ctx) {
  touch();
  const s = db.settings();
  const q = ctx.params.q || '', cat = ctx.params.cat || '';
  const all = db.all('passwords');
  const rows = all.filter(p => matches(p, q, ['name', 'url', 'username', 'category', 'notes'])).filter(p => !cat || p.category === cat).sort((a, b) => a.name.localeCompare(b.name));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
  el.innerHTML = `
    <div class="stats">
      ${statCard('Accès enregistrés', all.length)}
      ${statCard('Catégories', new Set(all.map(p => p.category)).size)}
      ${statCard('État du coffre', '🔓 Déverrouillé', 'verrouillage auto après 15 min', 'good')}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Mots de passe & accès</h2><div class="subtitle">Comptes de l’entreprise : banques, gouvernement, logiciels, fournisseurs…</div></div>
        <div class="actions">
          <button class="btn" data-lock>🔒 Verrouiller</button>
          <button class="btn" data-master>Changer le mot de passe maître</button>
          <button class="btn primary" data-new>+ Nouvel accès</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (service, identifiant, lien…)" value="${esc(q)}">
        <select data-cat><option value="">Toutes les catégories</option>${s.passwordCategories.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      ${table({
        columns: [
          { label: 'Compte', render: p => `<div class="strong">${esc(p.name)}</div>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="muted">${esc(host(p.url))} ↗</a>` : ''}` },
          { label: 'Catégorie', render: p => badge(p.category || '—', 'purple') },
          { label: 'Identifiant', render: p => p.username ? `<span class="mono">${esc(p.username)}</span> <button class="icon-btn" data-copy-user="${p.id}" title="Copier l’identifiant">⧉</button>` : '<span class="muted">—</span>' },
          { label: 'Mot de passe', render: p => `<span class="mono" data-pw="${p.id}">••••••••••</span> <button class="icon-btn" data-reveal="${p.id}" title="Afficher / masquer">👁</button><button class="icon-btn" data-copy-pw="${p.id}" title="Copier le mot de passe">⧉</button>` },
          { label: 'Notes', render: p => `<span class="muted">${esc(p.notes || '')}</span>` },
          { label: 'Modifié', render: p => dateFmt((p.updatedAt || '').slice(0, 10)) },
          { label: '', render: p => `<div class="row-actions"><button class="btn" data-edit="${p.id}">Modifier</button><button class="btn" data-del="${p.id}">Supprimer</button></div>` },
        ], rows, empty: all.length ? 'Aucun accès ne correspond.' : 'Aucun accès enregistré. Ajoutez vos comptes bancaires, gouvernementaux, logiciels…'
      })}
    </div>
    <p class="muted" style="font-size:12px">Sécurité : chiffrement AES-256-GCM dans le navigateur, clé dérivée du mot de passe maître (PBKDF2, 250 000 itérations). Les sauvegardes JSON contiennent les entrées chiffrées et restent lisibles uniquement avec le mot de passe maître.</p>`;

  const go = (patch) => ctx.navigate('passwords', '', { q, cat, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-cat]').addEventListener('change', e => go({ cat: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openEntryForm(null));
  el.querySelector('[data-lock]').addEventListener('click', () => { lock(); toast('Coffre verrouillé'); });
  el.querySelector('[data-master]').addEventListener('click', openChangeMaster);
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset; touch();
    if (d.edit) return openEntryForm(db.get('passwords', d.edit));
    if (d.del) { const p = db.get('passwords', d.del); if (await confirmDialog(`Supprimer l’accès « ${p.name} » ?`, { label: 'Supprimer' })) { db.remove('passwords', p.id); toast('Accès supprimé'); } return; }
    if (d.copyUser) return copy(db.get('passwords', d.copyUser).username || '', 'Identifiant copié');
    if (d.copyPw) { try { return copy(await decrypt(sessionKey, db.get('passwords', d.copyPw).password), 'Mot de passe copié'); } catch { return toast('Déchiffrement impossible.', 'err'); } }
    if (d.reveal) {
      const span = el.querySelector(`[data-pw="${d.reveal}"]`);
      if (span.dataset.shown) { span.textContent = '••••••••••'; delete span.dataset.shown; return; }
      try { span.textContent = await decrypt(sessionKey, db.get('passwords', d.reveal).password) || '(vide)'; span.dataset.shown = '1'; setTimeout(() => { if (span.isConnected) { span.textContent = '••••••••••'; delete span.dataset.shown; } }, 30000); }
      catch { toast('Déchiffrement impossible.', 'err'); }
    }
  });
}

export default {
  title: 'Mots de passe & accès',
  render(el, ctx) {
    if (!crypto?.subtle) { el.innerHTML = '<div class="card"><h2>Navigateur non compatible</h2><p>Le chiffrement nécessite un contexte sécurisé (HTTPS ou localhost).</p></div>'; return; }
    if (!vaultCfg()) return renderSetup(el, ctx);
    if (!sessionKey) return renderLocked(el, ctx);
    renderList(el, ctx);
  }
};
