// Planner (Opérations) : toutes les tâches de l'équipe, en liste ou en Kanban, filtrables par personne.
import { db } from '../store.js';
import { esc, daysUntil, toast, badge, statCard } from '../ui.js';
import { currentUser, isReadOnly } from '../auth.js';
import { TASK_OPEN, TASK_DOING, TASK_DONE, TASK_STATUSES, isDone, isDoing, assigneeName, dueLabel, setTaskStatus, openTaskForm, deleteTask, wireTasksList } from '../taches.js';

const STATUS_KIND = { [TASK_OPEN]: 'grey', [TASK_DOING]: 'blue', [TASK_DONE]: 'green' };
const PREF = 'planner:view';
const readPref = () => { try { return localStorage.getItem(PREF) || 'liste'; } catch (_) { return 'liste'; } };
const savePref = (v) => { try { localStorage.setItem(PREF, v); } catch (_) { /* navigation privée */ } };

const users = () => db.all('users').slice().sort((a, b) => a.name.localeCompare(b.name));
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const isLate = (t) => !isDone(t) && t.due && daysUntil(t.due) < 0;
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || '').localeCompare(b.createdAt || '');

function avatar(t) {
  const u = db.get('users', t.assigneeId); const name = assigneeName(t);
  if (!name) return '<span class="task-assignee muted">Non assignée</span>';
  return `<span class="task-assignee" title="Assignée à ${esc(name)}"><span class="task-avatar" style="${u?.color ? `background:${esc(u.color)}` : ''}">${esc(initials(name))}</span>${esc(name)}</span>`;
}
function formLink(t) {
  const f = t.formulationId ? db.get('formulations', t.formulationId) : null;
  return f ? `<a href="#/formulations/${f.id}" title="${esc(f.name || '')}">${esc(f.code)}</a>` : '';
}

export default {
  title: 'Planner',
  render(el, ctx) {
    const me = currentUser();
    const p = ctx.params || {};
    const who = p.who || 'tous';                       // tous | moi | <userId>
    const show = p.show || 'ouvertes';                 // ouvertes | terminees | toutes
    const q = (p.q || '').trim().toLowerCase();
    const view = p.view || readPref();                 // liste | kanban
    const go = (patch) => {
      const next = { who, show, q: p.q || '', view, ...patch };
      ctx.navigate('planner', '', Object.fromEntries(Object.entries(next).filter(([k, v]) => v && !(k === 'who' && v === 'tous') && !(k === 'show' && v === 'ouvertes'))));
    };

    const all = db.all('tasks');
    let list = all.slice();
    if (who === 'moi') list = list.filter(t => t.assigneeId === me?.id);
    else if (who !== 'tous') list = list.filter(t => t.assigneeId === who);
    if (q) list = list.filter(t => [t.title, t.notes, assigneeName(t), db.get('formulations', t.formulationId)?.code].some(x => String(x || '').toLowerCase().includes(q)));
    const visible = show === 'toutes' ? list : show === 'terminees' ? list.filter(isDone) : list.filter(t => !isDone(t));
    visible.sort((a, b) => (isDone(a) === isDone(b) ? 0 : isDone(a) ? 1 : -1) || byDue(a, b));

    const open = list.filter(t => !isDone(t));
    const late = open.filter(isLate).length;
    const doneWeek = list.filter(t => isDone(t) && t.doneAt && daysUntil(t.doneAt.slice(0, 10)) >= -7).length;
    const scope = who === 'moi' ? 'pour moi' : who === 'tous' ? 'dans l’équipe' : `pour ${esc(db.get('users', who)?.name || '')}`;
    const stats = `<div class="stats">
      ${statCard('À faire', open.filter(t => !isDoing(t)).length, scope)}
      ${statCard('En cours', open.filter(isDoing).length, '', 'good')}
      ${statCard('En retard', late, late ? 'échéance dépassée' : 'tout est dans les temps', late ? 'danger' : '')}
      ${statCard('Terminées', list.filter(isDone).length, `${doneWeek} cette semaine`)}
    </div>`;

    const whoOpts = [['tous', 'Toute l’équipe'], ['moi', 'Mes tâches'], ...users().filter(u => u.id !== me?.id).map(u => [u.id, u.name])];
    el.innerHTML = `
      <div class="page-head">
        <div><h2>Planner</h2><div class="muted">Toutes les tâches de l’équipe, à assigner et à suivre.</div></div>
        <div class="actions">
          <div class="seg" data-view>${[['liste', 'Liste'], ['kanban', 'Kanban']].map(([v, l]) => `<button type="button" class="${v === view ? 'active' : ''}" data-set-view="${v}">${l}</button>`).join('')}</div>
          ${isReadOnly() ? '' : '<button class="btn primary" data-new>+ Nouvelle tâche</button>'}
        </div>
      </div>
      ${stats}
      <div class="card">
        <div class="toolbar">
          <div class="seg" data-who>${whoOpts.map(([v, l]) => `<button type="button" class="${v === who ? 'active' : ''}" data-set-who="${esc(v)}">${esc(l)}</button>`).join('')}</div>
          <select data-show>${[['ouvertes', 'À faire et en cours'], ['terminees', 'Terminées'], ['toutes', 'Toutes']].map(([v, l]) => `<option value="${v}" ${v === show ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="spacer"></span>
          <input type="search" class="search" data-q value="${esc(p.q || '')}" placeholder="Rechercher une tâche…">
        </div>
        <div data-board>${view === 'kanban' ? kanbanHtml(list, show) : listHtml(visible)}</div>
      </div>`;

    el.querySelectorAll('[data-set-view]').forEach(b => b.addEventListener('click', () => { savePref(b.dataset.setView); go({ view: b.dataset.setView }); }));
    el.querySelectorAll('[data-set-who]').forEach(b => b.addEventListener('click', () => go({ who: b.dataset.setWho })));
    el.querySelector('[data-show]').addEventListener('change', e => go({ show: e.target.value }));
    el.querySelector('[data-q]').addEventListener('keydown', e => { if (e.key === 'Enter') go({ q: e.target.value }); });
    el.querySelector('[data-new]')?.addEventListener('click', () => openTaskForm(null));

    const board = el.querySelector('[data-board]');
    wireTasksList(board);
    board.addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit-task]'); if (edit) { const t = db.get('tasks', edit.dataset.editTask); if (t) openTaskForm(t); return; }
      const del = e.target.closest('[data-del-task]'); if (del) { await deleteTask(del.dataset.delTask); return; }
      const card = e.target.closest('.kanban-card'); if (card && !e.target.closest('a,button,input,label')) { const t = db.get('tasks', card.dataset.task); if (t && !isReadOnly()) openTaskForm(t); }
    });
    if (view === 'kanban') wireKanban(board);
  }
};

function listHtml(rows) {
  if (!rows.length) return '<div class="empty">Aucune tâche pour ce filtre.</div>';
  const ro = isReadOnly();
  return `<div class="table-wrap"><table class="planner-table">
    <thead><tr><th style="width:38px"></th><th>Tâche</th><th>Formulation</th><th>Assignée à</th><th>Échéance</th><th>Statut</th>${ro ? '' : '<th></th>'}</tr></thead>
    <tbody>${rows.map(t => `<tr class="${isDone(t) ? 'done' : ''} ${isLate(t) ? 'late' : ''}" data-task="${t.id}">
      <td><label class="task-done" title="${isDone(t) ? 'Marquer à faire' : 'Marquer comme terminée'}"><input type="checkbox" data-toggle-task="${t.id}" ${isDone(t) ? 'checked' : ''} ${ro ? 'disabled' : ''}></label></td>
      <td><div class="strong task-title">${esc(t.title)}</div>${t.notes ? `<div class="muted">${esc(t.notes)}</div>` : ''}</td>
      <td>${formLink(t) || '<span class="muted">—</span>'}</td>
      <td>${avatar(t)}</td>
      <td class="${isLate(t) ? 'late-cell' : ''}">${t.due ? esc(dueLabel(t)) : '<span class="muted">—</span>'}</td>
      <td>${badge(t.status || TASK_OPEN, STATUS_KIND[t.status] || 'grey')}${isDone(t) && t.doneBy ? `<div class="muted" style="font-size:11.5px">par ${esc(t.doneBy)}</div>` : ''}</td>
      ${ro ? '' : `<td><div class="row-actions"><button class="btn" data-edit-task="${t.id}">Modifier</button><button class="btn danger" data-del-task="${t.id}" title="Supprimer">✕</button></div></td>`}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function kanbanHtml(list, show) {
  const cols = show === 'terminees' ? [TASK_DONE] : TASK_STATUSES;
  const ro = isReadOnly();
  return `<div class="kanban">${cols.map(st => {
    const items = list.filter(t => (t.status || TASK_OPEN) === st).sort(byDue);
    return `<div class="kanban-col" data-status="${esc(st)}">
      <div class="kanban-head">${badge(st, STATUS_KIND[st])}<span class="muted">${items.length}</span></div>
      <div class="kanban-cards">${items.length ? items.map(t => `
        <div class="kanban-card ${isLate(t) ? 'late' : ''}" data-task="${t.id}" ${ro ? '' : 'draggable="true"'}>
          <div class="kanban-title">${esc(t.title)}</div>
          <div class="kanban-meta muted">${formLink(t) ? formLink(t) + ' · ' : ''}${t.due ? esc(dueLabel(t)) : 'Sans échéance'}</div>
          <div class="kanban-foot">${avatar(t)}${ro ? '' : `<button type="button" class="icon-btn" data-edit-task="${t.id}" title="Modifier">✎</button>`}</div>
        </div>`).join('') : '<div class="kanban-empty">Glisse une tâche ici</div>'}</div>
    </div>`;
  }).join('')}</div>`;
}

function wireKanban(board) {
  if (isReadOnly()) return;
  let dragging = null;
  board.addEventListener('dragstart', e => {
    const c = e.target.closest('.kanban-card'); if (!c) return;
    dragging = c.dataset.task; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragging); } catch (_) { /* ancien navigateur */ }
  });
  board.addEventListener('dragend', e => { e.target.closest('.kanban-card')?.classList.remove('dragging'); board.querySelectorAll('.kanban-col.over').forEach(c => c.classList.remove('over')); });
  board.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', e => { if (!dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('over');
      const id = dragging || e.dataTransfer.getData('text/plain'); dragging = null;
      const t = db.get('tasks', id); if (!t) return;
      const st = col.dataset.status; if ((t.status || TASK_OPEN) === st) return;
      try { setTaskStatus(id, st); toast(st === TASK_DONE ? 'Tâche terminée' : st === TASK_DOING ? 'Tâche en cours' : 'Tâche remise à faire'); }
      catch (err) { toast(err.message, 'warn'); }
    });
  });
}
