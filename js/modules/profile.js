// Mon profil : informations du compte, mot de passe, et gestion des utilisateurs (administrateur·rice).
import { db } from '../store.js';
import { esc, toast, confirmDialog, openModal, field, table, badge, dateFmt, statCard } from '../ui.js';
import { currentUser, isAdmin, ROLES, roleLabel, createUser, setPassword, verifyPassword, initials, pickColor, logout, avatarHtml } from '../auth.js';

const ROLE_KIND = { admin: 'purple', formulatrice: 'blue', lecture: 'grey' };
const COLORS = ['#8d7bf0', '#f06b9c', '#3b9ddd', '#2f9e6b', '#e0903b', '#8a5cf5', '#d64545', '#2bb3b1'];

export default {
  title: 'Mon profil',
  render(el, ctx) {
    const me = db.get('users', currentUser()?.id) || currentUser();
    const users = db.all('users').slice().sort((a, b) => a.name.localeCompare(b.name));
    const myForms = db.all('formulations').filter(f => (f.author || '').toLowerCase() === me.name.toLowerCase()).length;
    const myChats = db.all('chats').length;
    el.innerHTML = `
      <div class="profile-hero card">
        ${avatarHtml(me, 'profile-avatar')}
        <div class="topbar-text">
          <h2>${esc(me.name)}</h2>
          <div class="muted">${esc(me.email)} · ${badge(roleLabel(me.role), ROLE_KIND[me.role] || 'grey')}</div>
          <div class="muted" style="margin-top:4px">Dernière connexion : ${me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'} · Compte créé le ${dateFmt((me.createdAt || '').slice(0, 10))}</div>
        </div>
        <div class="actions"><button class="btn" data-logout>Se déconnecter</button></div>
      </div>
      <div class="stats">
        ${statCard('Formulations à mon nom', myForms)}
        ${statCard('Discussions avec l’assistante', myChats)}
        ${statCard('Utilisateurs', users.length)}
      </div>
      <div class="grid two">
        <div class="card">
          <h3>Mes informations</h3>
          <form data-info class="form-grid" style="margin-top:14px">
            ${field({ label: 'Nom complet', name: 'name', value: me.name, required: true, cols: 4 })}
            ${field({ label: 'Courriel', name: 'email', type: 'email', value: me.email, required: true, cols: 4 })}
            <div class="field cols-4"><label>Couleur de l’avatar</label><div class="color-row">${COLORS.map(c => `<button type="button" class="color-dot ${c === me.color ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div><input type="hidden" name="color" value="${esc(me.color || COLORS[0])}"></div>
            <div class="field cols-4"><button type="submit" class="btn primary">Enregistrer</button></div>
          </form>
        </div>
        <div class="card">
          <h3>Changer mon mot de passe</h3>
          <form data-pass class="form-grid" style="margin-top:14px">
            ${field({ label: 'Mot de passe actuel', name: 'current', type: 'password', required: true, cols: 4, attrs: 'autocomplete="current-password"' })}
            ${field({ label: 'Nouveau mot de passe', name: 'next', type: 'password', required: true, cols: 2, attrs: 'autocomplete="new-password" minlength="6"' })}
            ${field({ label: 'Confirmer', name: 'confirm', type: 'password', required: true, cols: 2, attrs: 'autocomplete="new-password" minlength="6"' })}
            <div class="field cols-4"><button type="submit" class="btn primary">Mettre à jour</button></div>
          </form>
        </div>
      </div>
      ${isAdmin() ? `
      <div class="card">
        <div class="card-head"><h3>Utilisateurs</h3><button class="btn primary" data-add-user>+ Ajouter un utilisateur</button></div>
        <p class="muted" style="margin-bottom:12px">Rôles : <b>Administrateur·rice</b> gère les utilisateurs et les paramètres ; <b>Formulateur·rice</b> travaille sur tout le laboratoire ; <b>Lecture seule</b> consulte sans modifier.</p>
        ${table({
          columns: [
            { label: '', width: '44px', render: u => avatarHtml(u, 'list-avatar') },
            { label: 'Nom', render: u => `<div class="strong">${esc(u.name)}${u.id === me.id ? ' <span class="muted">(vous)</span>' : ''}</div><div class="muted">${esc(u.email)}</div>` },
            { label: 'Rôle', render: u => badge(roleLabel(u.role), ROLE_KIND[u.role] || 'grey') },
            { label: 'Dernière connexion', render: u => u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '<span class="muted">jamais</span>' },
            { label: '', render: u => `<div class="row-actions"><button class="btn sm" data-edit-user="${u.id}">Modifier</button><button class="btn sm" data-reset-user="${u.id}">Mot de passe</button>${u.id !== me.id ? `<button class="btn sm danger" data-del-user="${u.id}">Supprimer</button>` : ''}</div>` },
          ], rows: users
        })}
      </div>` : ''}
      <p class="muted" style="font-size:12px">Les comptes et leurs empreintes de mot de passe (PBKDF2-SHA-256, 150 000 itérations) sont enregistrés dans ce navigateur avec le reste des données. Cette connexion protège l’accès à l’application sur un poste partagé ; elle ne chiffre pas les données elles-mêmes, qui restent lisibles par quiconque a accès au profil du navigateur. Les sauvegardes JSON contiennent les comptes.</p>`;

    el.querySelector('[data-logout]').addEventListener('click', logout);
    const info = el.querySelector('[data-info]');
    info.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { info.querySelectorAll('[data-color]').forEach(x => x.classList.remove('on')); b.classList.add('on'); info.color.value = b.dataset.color; }));
    info.addEventListener('submit', e => {
      e.preventDefault();
      const name = info.name.value.trim(), email = info.email.value.trim().toLowerCase();
      if (!name || !email) return toast('Nom et courriel sont obligatoires.', 'warn');
      if (db.all('users').some(u => u.id !== me.id && u.email === email)) return toast('Ce courriel est déjà utilisé par un autre compte.', 'warn');
      db.update('users', me.id, { name, email, color: info.color.value });
      Object.assign(currentUser(), { name, email, color: info.color.value });
      document.dispatchEvent(new CustomEvent('user-changed'));
      toast('Profil enregistré');
    });
    el.querySelector('[data-pass]').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      if (f.next.value !== f.confirm.value) return toast('Les deux mots de passe ne correspondent pas.', 'warn');
      if (!await verifyPassword(db.get('users', me.id), f.current.value)) return toast('Mot de passe actuel incorrect.', 'warn');
      try { await setPassword(me.id, f.next.value); f.reset(); toast('Mot de passe mis à jour'); } catch (ex) { toast(ex.message, 'warn'); }
    });

    if (!isAdmin()) return;
    el.querySelector('[data-add-user]').addEventListener('click', () => openModal({
      title: 'Nouvel utilisateur',
      body: `<div class="form-grid">
        ${field({ label: 'Nom complet', name: 'name', required: true, cols: 4 })}
        ${field({ label: 'Courriel', name: 'email', type: 'email', required: true, cols: 4 })}
        ${field({ label: 'Rôle', name: 'role', type: 'select', options: ROLES, value: 'formulatrice', cols: 2 })}
        ${field({ label: 'Mot de passe provisoire', name: 'password', type: 'text', required: true, cols: 2, help: 'À transmettre à la personne, qui pourra le changer dans son profil.', attrs: 'minlength="6"' })}
      </div>`,
      submitLabel: 'Créer le compte',
      async onSubmit(d) { await createUser({ name: d.name, email: d.email, password: d.password, role: d.role, color: pickColor() }); toast(`Compte créé pour ${d.name}`); }
    }));
    el.addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit-user]'), reset = e.target.closest('[data-reset-user]'), del = e.target.closest('[data-del-user]');
      if (edit) {
        const u = db.get('users', edit.dataset.editUser);
        openModal({ title: `Modifier — ${u.name}`, body: `<div class="form-grid">${field({ label: 'Nom complet', name: 'name', value: u.name, required: true, cols: 4 })}${field({ label: 'Courriel', name: 'email', type: 'email', value: u.email, required: true, cols: 4 })}${field({ label: 'Rôle', name: 'role', type: 'select', options: ROLES, value: u.role, cols: 2 })}</div>`,
          onSubmit(d) {
            if (u.id === me.id && d.role !== 'admin' && db.all('users').filter(x => x.role === 'admin').length === 1) { toast('Il faut au moins un·e administrateur·rice.', 'warn'); return false; }
            db.update('users', u.id, { name: d.name.trim(), email: d.email.trim().toLowerCase(), role: d.role }); toast('Utilisateur mis à jour');
          } });
      }
      if (reset) {
        const u = db.get('users', reset.dataset.resetUser);
        openModal({ title: `Réinitialiser le mot de passe — ${u.name}`, body: `<div class="form-grid">${field({ label: 'Nouveau mot de passe provisoire', name: 'password', type: 'text', required: true, cols: 4, attrs: 'minlength="6"' })}</div>`, submitLabel: 'Réinitialiser',
          async onSubmit(d) { await setPassword(u.id, d.password, { mustChange: true }); toast('Mot de passe réinitialisé'); } });
      }
      if (del) {
        const u = db.get('users', del.dataset.delUser);
        if (u.role === 'admin' && db.all('users').filter(x => x.role === 'admin').length === 1) return toast('Impossible de supprimer le dernier compte administrateur.', 'warn');
        if (await confirmDialog(`Supprimer le compte de « ${u.name} » ?`, { label: 'Supprimer' })) { db.remove('users', u.id); toast('Compte supprimé'); }
      }
    });
  }
};
