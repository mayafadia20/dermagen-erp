// Tâches créées depuis une formulation et assignées à un membre de l'équipe (collection `tasks`).
// Une tâche : { id, formulationId, title, assigneeId, assigneeName, due, status: 'À faire' | 'Terminée', doneAt, doneBy, createdBy, order }
import { db } from './store.js';
import { esc, dateFmt, daysUntil, toast } from './ui.js';
import { currentUser } from './auth.js';

export const TASK_OPEN = 'À faire', TASK_DONE = 'Terminée';

const users = () => db.all('users').slice().sort((a, b) => a.name.localeCompare(b.name));
export const tasksOf = (formulationId) => db.all('tasks').filter(t => t.formulationId === formulationId).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
export const isDone = (t) => t.status === TASK_DONE;
export const openTasks = () => db.all('tasks').filter(t => !isDone(t));
export const assigneeName = (t) => db.get('users', t.assigneeId)?.name || t.assigneeName || '';
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

export function taskSummary(list) {
  if (!list.length) return 'Aucune tâche';
  const done = list.filter(isDone).length;
  return done === list.length ? `${list.length} tâche(s), toutes terminées` : `${list.length - done} à faire sur ${list.length}`;
}

export function dueLabel(t) {
  if (!t.due) return '';
  const d = daysUntil(t.due);
  if (isDone(t)) return dateFmt(t.due);
  return `${dateFmt(t.due)} · ${d < 0 ? `en retard de ${-d} j` : d === 0 ? 'aujourd’hui' : `dans ${d} j`}`;
}

// ---------- Éditeur dans le formulaire ----------
function taskRow(t = {}) {
  const me = currentUser();
  const sel = t.assigneeId || (t.id ? '' : me?.id || '');
  const opts = ['<option value="">— Non assignée —</option>', ...users().map(u => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`)].join('');
  const done = !!(t.id && isDone(t));
  return `<div class="task-row ${done ? 'done' : ''}" data-repeat-row data-task-id="${t.id || ''}">
    <label class="task-done" title="${t.id ? 'Terminée' : 'Enregistrer comme déjà terminée'}"><input type="checkbox" name="done" ${done ? 'checked' : ''}></label>
    <input name="title" value="${esc(t.title || '')}" placeholder="ex. Lancer le test de stabilité à 40 °C">
    <select name="assigneeId" title="Assignée à">${opts}</select>
    <input name="due" type="date" value="${esc(t.due || '')}" title="Échéance">
    <button type="button" class="icon-btn del" data-del-task title="Retirer">✕</button>
  </div>`;
}

export function tasksEditor(list, { fresh = false } = {}) {
  const rows = list.length ? list : (fresh ? [{}] : []);
  return `<div class="tasks-editor" data-tasks>
    <div class="task-head"><span></span><span>Tâche</span><span>Assignée à</span><span>Échéance</span><span></span></div>
    <div data-task-rows>${rows.map(t => taskRow(t)).join('')}</div>
    <div class="lines-foot"><button type="button" class="btn sm" data-add-task>+ Ajouter une tâche</button><span class="muted">Créées à l’enregistrement ; visibles sur la fiche et sur le tableau de bord de la personne assignée.</span></div>
  </div>`;
}

export function readTasks(form) {
  return [...form.querySelectorAll('[data-tasks] [data-repeat-row]')].map(r => ({
    id: r.dataset.taskId || '',
    title: r.querySelector('[name=title]').value.trim(),
    assigneeId: r.querySelector('[name=assigneeId]').value,
    due: r.querySelector('[name=due]').value,
    done: r.querySelector('[name=done]').checked
  })).filter(t => t.title);
}

/** Crée, met à jour et supprime les tâches d'une formulation pour qu'elles reflètent l'éditeur. */
export function syncTasks(formulationId, rows) {
  const before = tasksOf(formulationId), keep = new Set(rows.map(r => r.id).filter(Boolean));
  const me = currentUser(); const now = new Date().toISOString();
  let created = 0, updated = 0, removed = 0;
  for (const t of before) if (!keep.has(t.id)) { db.remove('tasks', t.id); removed++; }
  rows.forEach((r, i) => {
    const assignee = db.get('users', r.assigneeId);
    const data = { title: r.title, assigneeId: r.assigneeId || '', assigneeName: assignee?.name || '', due: r.due || '', order: i };
    const ex = r.id && db.get('tasks', r.id);
    if (ex) {
      if (r.done !== isDone(ex)) { data.status = r.done ? TASK_DONE : TASK_OPEN; data.doneAt = r.done ? now : ''; data.doneBy = r.done ? me?.name || '' : ''; }
      db.update('tasks', ex.id, data); updated++;
    } else {
      db.insert('tasks', { ...data, formulationId, status: r.done ? TASK_DONE : TASK_OPEN, doneAt: r.done ? now : '', doneBy: r.done ? me?.name || '' : '', createdBy: me?.name || '', createdById: me?.id || '' });
      created++;
    }
  });
  return { created, updated, removed };
}

/** Branche l'éditeur (ajout / retrait de lignes) : à appeler une fois sur le formulaire. */
export function wireTasksEditor(form) {
  const box = form.querySelector('[data-tasks]'); if (!box) return;
  box.querySelector('[data-add-task]').addEventListener('click', () => {
    const rows = box.querySelector('[data-task-rows]');
    rows.insertAdjacentHTML('beforeend', taskRow({})); rows.lastElementChild.querySelector('[name=title]').focus();
  });
  box.addEventListener('click', e => { const b = e.target.closest('[data-del-task]'); if (b) b.closest('[data-repeat-row]').remove(); });
  box.addEventListener('change', e => { if (e.target.name === 'done') e.target.closest('.task-row').classList.toggle('done', e.target.checked); });
}

// ---------- Liste sur la fiche et le tableau de bord ----------
export function tasksHtml(list, { showFormulation = false, empty = 'Aucune tâche. Modifie la formulation pour en créer et les assigner.' } = {}) {
  if (!list.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<ul class="task-list">${list.map(t => {
    const u = db.get('users', t.assigneeId); const name = assigneeName(t);
    const f = showFormulation ? db.get('formulations', t.formulationId) : null;
    const late = !isDone(t) && t.due && daysUntil(t.due) < 0;
    return `<li class="task-item ${isDone(t) ? 'done' : ''} ${late ? 'late' : ''}" data-task="${t.id}">
      <label class="task-done" title="${isDone(t) ? 'Marquer à faire' : 'Marquer comme terminée'}"><input type="checkbox" data-toggle-task="${t.id}" ${isDone(t) ? 'checked' : ''}></label>
      <div class="task-body">
        <div class="task-title">${esc(t.title)}</div>
        <div class="muted task-meta">${f ? `<a href="#/formulations/${f.id}">${esc(f.code)}</a> · ` : ''}${t.due ? esc(dueLabel(t)) : 'Sans échéance'}${isDone(t) && t.doneBy ? ` · terminée par ${esc(t.doneBy)}` : ''}</div>
      </div>
      ${name ? `<span class="task-assignee" title="Assignée à ${esc(name)}"><span class="task-avatar" style="${u?.color ? `background:${esc(u.color)}` : ''}">${esc(initials(name))}</span>${esc(name)}</span>` : '<span class="task-assignee muted">Non assignée</span>'}
    </li>`;
  }).join('')}</ul>`;
}

/** Cases à cocher de la liste : bascule À faire / Terminée sans ouvrir le formulaire. */
export function wireTasksList(el) {
  if (!el) return;
  el.addEventListener('change', e => {
    const cb = e.target.closest('[data-toggle-task]'); if (!cb) return;
    const t = db.get('tasks', cb.dataset.toggleTask); if (!t) return;
    const me = currentUser();
    try {
      db.update('tasks', t.id, cb.checked ? { status: TASK_DONE, doneAt: new Date().toISOString(), doneBy: me?.name || '' } : { status: TASK_OPEN, doneAt: '', doneBy: '' });
      toast(cb.checked ? 'Tâche terminée' : 'Tâche remise à faire');
    } catch (err) { cb.checked = !cb.checked; toast(err.message, 'warn'); }
  });
}
