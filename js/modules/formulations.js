// Formulations R&D : recettes hebdomadaires, composition en %, coût, fabrication de lots.
import { db } from '../store.js';
import { esc, money, num, dateFmt, today, isoWeek, toast, badge, openModal, confirmDialog, field, table, matches, statCard, costPerGram, gramsToUnit } from '../ui.js';
import { recordMovement } from './ingredients.js';
import { importEssais, ESSAIS_TAG } from '../essais.js';
import { currentUser } from '../auth.js';
import { ensureRecipes, recipeLines, PHASE_LABEL } from '../recettes.js';
import { currentUser as whoami } from '../auth.js';
import { tasksEditor, wireTasksEditor, readTasks, syncTasks, tasksOf, tasksHtml, wireTasksList, taskSummary, openTasks } from '../taches.js';

export const STATUSES = ['En développement', 'En test', 'Validée', 'Abandonnée'];
const STATUS_KIND = { 'En développement': 'blue', 'En test': 'amber', 'Validée': 'green', 'Abandonnée': 'grey' };
const PHASES = ['A', 'B', 'C', 'D', 'E'];

function nextCode(date) {
  const w = isoWeek(date);
  const prefix = `F-${w.year}-S${String(w.week).padStart(2, '0')}-`;
  const n = db.all('formulations').filter(f => (f.code || '').startsWith(prefix)).length + 1;
  return prefix + String(n).padStart(2, '0');
}

export function formulationCost(f) {
  const batch = Number(f.batchSize) || 100;
  let total = 0, missing = 0;
  for (const l of f.lines || []) {
    const ing = db.get('ingredients', l.ingredientId);
    const grams = batch * (Number(l.pct) || 0) / 100;
    if (ing) total += grams * costPerGram(ing); else missing++;
  }
  return { total, per100g: batch ? total / batch * 100 : 0, missing };
}
export const totalPct = (f) => (f.lines || []).reduce((t, l) => t + (Number(l.pct) || 0), 0);


// ---------- Mode opératoire en étapes ----------
export const stepsOf = (x) => Array.isArray(x.steps) && x.steps.length ? x.steps : String(x.procedure || '').split('\n').map(t => t.trim()).filter(Boolean);
function stepRow(text = '') { return `<div class="step-row" data-repeat-row><span class="step-no"></span><input name="step" value="${esc(text)}" placeholder="Décris l’étape…"><button type="button" class="icon-btn del" data-del-step title="Retirer">✕</button></div>`; }
function stepsEditor(steps) {
  return `<div class="field cols-4"><label>Mode opératoire (étapes, dans l’ordre)</label>
    <div class="steps-editor" data-steps>${steps.map(stepRow).join('')}</div>
    <button type="button" class="btn sm" data-add-step style="align-self:flex-start;margin-top:6px">+ Ajouter une étape</button></div>`;
}
function wireStepsEditor(form) {
  const box = form.querySelector('[data-steps]'); if (!box) return;
  const renumber = () => box.querySelectorAll('.step-row').forEach((r, i) => r.querySelector('.step-no').textContent = i + 1);
  form.querySelector('[data-add-step]').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', stepRow()); renumber(); box.querySelector('.step-row:last-child input').focus(); });
  box.addEventListener('click', e => { const b = e.target.closest('[data-del-step]'); if (b) { b.closest('.step-row').remove(); renumber(); } });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.name === 'step') { e.preventDefault(); e.stopPropagation(); form.querySelector('[data-add-step]').click(); } });
  renumber();
}
const readSteps = (form) => [...form.querySelectorAll('[data-steps] input[name=step]')].map(i => i.value.trim()).filter(Boolean);
function stepsHtml(steps, { editable = false } = {}) {
  if (!steps.length) return `<div class="empty">Aucune étape.${editable ? ' Ajoute la première étape ci-dessous.' : ''}</div>`;
  return `<ol class="steps">${steps.map((st, i) => `<li class="step-chip"><span class="step-no">${i + 1}</span><span class="step-text" ${editable ? `data-edit-step="${i}" title="Modifier cette étape"` : ''}>${esc(st)}</span>${editable ? `<button type="button" class="icon-btn del" data-remove-step="${i}" title="Retirer">✕</button>` : ''}</li>`).join('')}</ol>`;
}

// ---------- Éditeur ----------
function lineRow(l = {}, ingredients, sheetIds = new Set()) {
  const opt = (i) => `<option value="${i.id}" data-cost="${costPerGram(i)}" ${i.id === l.ingredientId ? 'selected' : ''}>${esc(i.name)}${i.inci ? ' (' + esc(i.inci) + ')' : ''}</option>`;
  const inSheet = ingredients.filter(i => sheetIds.has(i.id)), others = ingredients.filter(i => !sheetIds.has(i.id));
  const opts = ['<option value="">— Choisir —</option>',
    ...(inSheet.length ? [`<optgroup label="Ingrédients de la fiche théorique">${inSheet.map(opt).join('')}</optgroup>`] : []),
    `<optgroup label="${inSheet.length ? 'Tous les ingrédients de l’inventaire' : 'Ingrédients de l’inventaire'}">${others.map(opt).join('')}</optgroup>`].join('');
  return `<tr data-repeat-row>
    <td class="line-grip" draggable="true" title="Glisser pour déplacer la ligne"><span class="grip">⋮⋮</span><span class="line-arrows"><button type="button" data-move-line="up" title="Monter">▲</button><button type="button" data-move-line="down" title="Descendre">▼</button></span></td>
    <td style="width:70px"><select name="phase">${PHASES.map(p => `<option ${p === (l.phase || 'A') ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
    <td><select name="ingredientId">${opts}</select></td>
    <td style="width:110px"><input name="pct" type="number" step="0.001" min="0" max="100" value="${l.pct ?? ''}" placeholder="%"></td>
    <td style="width:130px"><input name="qty" type="number" step="0.001" min="0" placeholder="g" title="Quantité en grammes pour le lot de référence"></td>
    <td style="width:110px" class="num" data-cost>—</td>
    <td><input name="role" value="${esc(l.role || '')}" placeholder="Fonction"></td>
    <td style="width:40px"><button type="button" class="icon-btn del" data-del-line title="Retirer">✕</button></td>
  </tr>`;
}

/** fromRecipe : fiche théorique de rattachement ; fromFormulation (facultatif, avec fromRecipe) : version réelle dont on reprend
 *  les ingrédients et le mode opératoire au lieu de ceux de la fiche. */
export function openFormulationForm(existing, onDone, { duplicateFrom, fromRecipe, fromFormulation } = {}) {
  const s = db.settings();
  const recipes = db.all('recipes').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const src = fromRecipe && fromFormulation ? fromFormulation : null;   // version réelle choisie comme base
  const fromR = fromRecipe ? {
    code: nextCode(today()), date: today(), version: db.all('formulations').filter(x => x.recipeId === fromRecipe.id).length + 1, status: STATUSES[0],
    productType: src?.productType || 'Traitement lissant', batchSize: src?.batchSize || 100, recipeId: fromRecipe.id, name: fromRecipe.name,
    objective: src?.objective || fromRecipe.description || '', parentCode: src?.code,
    steps: src ? stepsOf(src).slice() : (fromRecipe.steps || []).slice(),
    lines: src ? (src.lines || []).map(l => ({ phase: l.phase, ingredientId: l.ingredientId, pct: l.pct, role: l.role })) : recipeLines(fromRecipe).map(l => ({ phase: l.phase, ingredientId: l.ingredientId, pct: l.pct, role: l.role })),
  } : null;
  const ingredients = db.all('ingredients').filter(i => i.category !== 'Matériel de laboratoire').slice().sort((a, b) => a.name.localeCompare(b.name));
  const sheet = fromRecipe || (existing?.recipeId ? db.get('recipes', existing.recipeId) : null) || (duplicateFrom?.recipeId ? db.get('recipes', duplicateFrom.recipeId) : null);
  const sheetIds = new Set(sheet ? recipeLines(sheet).map(l => l.ingredientId) : []);
  const base = duplicateFrom ? { ...duplicateFrom, id: undefined, code: nextCode(today()), date: today(), version: (Number(duplicateFrom.version) || 1) + 1, status: 'En développement', parentCode: duplicateFrom.code, notes: '' } : null;
  const f = base || fromR || existing || { code: nextCode(today()), date: today(), version: 1, status: STATUSES[0], productType: s.productTypes[0], batchSize: 100, lines: [{ phase: 'A' }, { phase: 'A' }, { phase: 'B' }] };
  const m = openModal({
    title: fromR ? `Nouvelle formulation — ${fromRecipe.name}${src ? ` (à partir de ${src.code} v${src.version || 1})` : ' (formule théorique)'}` : base ? `Nouvelle version de ${duplicateFrom.code}` : existing ? 'Modifier la formulation' : 'Nouvelle formulation', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'Code', name: 'code', value: f.code, required: true, cols: 1 })}
      ${field({ label: 'Nom de la formulation', name: 'name', value: f.name, required: true, cols: 2, placeholder: 'ex. Masque réparateur kératine v2' })}
      ${field({ label: 'Version', name: 'version', type: 'number', min: 1, value: f.version, cols: 1 })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: f.date, required: true, cols: 1, help: 'Détermine la semaine R&D' })}
      ${field({ label: 'Type de produit', name: 'productType', type: 'select', options: s.productTypes, value: f.productType, cols: 1 })}
      ${field({ label: 'Statut', name: 'status', type: 'select', options: STATUSES, value: f.status, cols: 1 })}
      ${field({ label: 'Taille du lot de référence (g)', name: 'batchSize', type: 'number', step: '1', min: 1, value: f.batchSize, cols: 1 })}
      ${field({ label: 'Fiche théorique (cahier de charge)', name: 'recipeId', type: 'select', options: [['', '— Aucune —'], ...recipes.map(r => [r.id, r.name])], value: f.recipeId || '', cols: 4, help: fromR ? 'Les ingrédients et pourcentages ci-dessous sont repris de la fiche : ajuste-les ou ajoute des lignes.' : '' })}
      ${field({ label: 'Objectif / hypothèse de recherche', name: 'objective', type: 'textarea', rows: 2, value: f.objective, cols: 4, placeholder: 'ex. Améliorer le lissage sans formaldéhyde sur cheveux poreux' })}
      <div class="form-section">Composition (total doit faire 100 %)</div>
      <div class="lines">
        <table><thead><tr><th></th><th>Phase</th><th>Ingrédient</th><th>%</th><th>Quantité (g)</th><th class="num">Coût</th><th>Fonction</th><th></th></tr></thead>
        <tbody data-lines>${(f.lines || []).map(l => lineRow(l, ingredients, sheetIds)).join('')}</tbody></table>
        <div class="lines-foot"><button type="button" class="btn sm" data-add-line>+ Ajouter une ligne</button><span>Total : <b data-total-pct>0</b> % · Coût du lot : <b data-total-cost>0</b> · <span data-per100></span></span></div>
      </div>
      <div class="form-section">Mode opératoire, observations et résultats</div>
      ${stepsEditor(stepsOf(f))}
      ${field({ label: 'pH', name: 'ph', value: f.ph, cols: 1 })}
      ${field({ label: 'Viscosité / texture', name: 'viscosity', value: f.viscosity, cols: 1 })}
      ${field({ label: 'Aspect / odeur', name: 'aspect', value: f.aspect, cols: 1 })}
      ${field({ label: 'Stabilité', name: 'stability', value: f.stability, cols: 1, placeholder: 'ex. Stable 4 sem. à 40 °C' })}
      <div class="form-section">Tâches à créer et à assigner</div>
      ${tasksEditor(existing ? tasksOf(existing.id) : [], { fresh: !existing })}
      ${field({ label: 'Commentaires pour la prochaine fois', name: 'notes', type: 'textarea', rows: 2, value: f.notes, cols: 4, placeholder: 'ex. Réduire le BTMS-50 à 3 %, mesurer le pH à froid, lancer le test 40 °C' })}
      ${field({ label: 'Formulateur·rice', name: 'author', value: f.author || (existing ? '' : currentUser()?.name || ''), cols: 2 })}
    </div>`,
    submitLabel: existing ? 'Enregistrer' : 'Créer la formulation',
    onSubmit(data, { form }) {
      const lines = readLines(form);
      if (!lines.length) { toast('Ajoutez au moins un ingrédient.', 'warn'); return false; }
      data.lines = lines; data.batchSize = Number(data.batchSize) || 100; data.version = Number(data.version) || 1;
      data.steps = readSteps(form); data.procedure = data.steps.join('\n');
      data.weekKey = isoWeek(data.date).key;
      const tasks = readTasks(form);
      if (existing) { db.update('formulations', existing.id, data); const n = syncTasks(existing.id, tasks); toast('Formulation mise à jour' + (n.created ? ` · ${n.created} tâche(s) créée(s)` : '')); onDone && onDone(existing.id); }
      else { if (base) data.parentCode = base.parentCode; else if (fromR?.parentCode) data.parentCode = fromR.parentCode; const rec = db.insert('formulations', data); const n = syncTasks(rec.id, tasks); toast('Formulation créée' + (n.created ? ` · ${n.created} tâche(s) assignée(s)` : '')); onDone && onDone(rec.id); }
    }
  });
  const form = m.form;
  wireStepsEditor(form);
  wireTasksEditor(form);
  const tbody = form.querySelector('[data-lines]');
  const recalc = (e) => {
    const batch = Number(form.querySelector('[name=batchSize]').value) || 100;
    const src = e && e.target;
    let pct = 0, cost = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      const pctEl = tr.querySelector('[name=pct]'), qtyEl = tr.querySelector('[name=qty]');
      /* La quantité en grammes et le pourcentage se déduisent l'un de l'autre selon le champ modifié */
      if (src === qtyEl) { const g = Number(qtyEl.value) || 0; pctEl.value = batch ? String(Math.round(g / batch * 100 * 1000) / 1000) : ''; }
      const p = Number(pctEl.value) || 0;
      const grams = batch * p / 100;
      if (src !== qtyEl && document.activeElement !== qtyEl) qtyEl.value = pctEl.value === '' ? '' : String(Math.round(grams * 1000) / 1000);
      const opt = tr.querySelector('[name=ingredientId]').selectedOptions[0];
      const cpg = Number(opt?.dataset.cost) || 0;
      tr.querySelector('td[data-cost]').textContent = money(grams * cpg);
      pct += p; cost += grams * cpg;
    });
    const tp = form.querySelector('[data-total-pct]');
    tp.textContent = num(pct, 3); tp.className = Math.abs(pct - 100) < 0.01 ? 'pct-ok' : 'pct-bad';
    form.querySelector('[data-total-cost]').textContent = money(cost);
    form.querySelector('[data-per100]').textContent = money(batch ? cost / batch * 100 : 0) + ' / 100 g';
  };
  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);
  form.querySelector('[data-add-line]').addEventListener('click', () => {
    const last = tbody.querySelector('tr:last-child [name=phase]')?.value || 'A';
    tbody.insertAdjacentHTML('beforeend', lineRow({ phase: last }, ingredients, sheetIds)); recalc();
    tbody.lastElementChild.querySelector('[name=ingredientId]').focus();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-del-line]'); if (b) { b.closest('tr').remove(); recalc(); return; }
    const mv = e.target.closest('[data-move-line]');
    if (mv) {
      const tr = mv.closest('tr'), other = mv.dataset.moveLine === 'up' ? tr.previousElementSibling : tr.nextElementSibling;
      if (other) { mv.dataset.moveLine === 'up' ? other.before(tr) : other.after(tr); flashRow(tr); }
    }
  });
  /* Changer la phase d'une ligne la range avec les autres lignes de cette phase (ordre A, B, C… ; l'ordre dans la phase est conservé) */
  tbody.addEventListener('change', e => {
    if (e.target.name !== 'phase') return;
    const tr = e.target.closest('tr');
    tr.remove();
    const rank = (r) => PHASES.indexOf(r.querySelector('[name=phase]').value);
    const rows = [...tbody.querySelectorAll('tr')], mine = rank(tr);
    const after = rows.filter(r => rank(r) <= mine).pop();
    after ? after.after(tr) : tbody.prepend(tr);
    flashRow(tr); e.target.focus();
  });
  wireLineDrag(tbody);
  recalc();
}

function flashRow(tr) { tr.classList.add('line-moved'); setTimeout(() => tr.classList.remove('line-moved'), 700); }

/* Glisser-déposer des lignes par la poignée ⋮⋮ (la phase choisie n'est pas modifiée par un déplacement manuel) */
function wireLineDrag(tbody) {
  let dragged = null;
  tbody.addEventListener('dragstart', e => {
    const grip = e.target.closest('.line-grip'); if (!grip) { e.preventDefault(); return; }
    dragged = grip.closest('tr'); dragged.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'line'); } catch { /* ignore */ }
  });
  tbody.addEventListener('dragover', e => {
    if (!dragged) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest('tr'); if (!over || over === dragged) return;
    const box = over.getBoundingClientRect();
    (e.clientY - box.top) < box.height / 2 ? over.before(dragged) : over.after(dragged);
  });
  tbody.addEventListener('drop', e => { e.preventDefault(); });
  tbody.addEventListener('dragend', () => { if (dragged) { dragged.classList.remove('dragging'); flashRow(dragged); } dragged = null; });
}

function readLines(form) {
  return [...form.querySelectorAll('[data-lines] [data-repeat-row]')].map(tr => ({
    phase: tr.querySelector('[name=phase]').value,
    ingredientId: tr.querySelector('[name=ingredientId]').value,
    pct: Number(tr.querySelector('[name=pct]').value) || 0,
    role: tr.querySelector('[name=role]').value.trim()
  })).filter(l => l.ingredientId);
}

// ---------- Fabrication d'un lot ----------
function openProduceForm(f, ctx) {
  const pct = totalPct(f);
  openModal({
    title: `Fabriquer un lot — ${f.code}`,
    body: `<div class="form-grid">
      ${Math.abs(pct - 100) > 0.01 ? `<div class="field cols-4"><div class="warnbox">Attention : la composition totalise ${num(pct, 2)} % (et non 100 %).</div></div>` : ''}
      ${field({ label: 'Quantité à fabriquer (g)', name: 'qty', type: 'number', min: 1, step: '1', value: f.batchSize || 100, required: true, cols: 2 })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: today(), cols: 2 })}
      ${field({ label: 'N° de lot fabriqué', name: 'lot', value: `${f.code}-L${String((f.batches || []).length + 1).padStart(2, '0')}`, cols: 2 })}
      ${field({ label: 'Remarques', name: 'notes', cols: 2 })}
      <div class="field cols-4"><small>Les quantités de chaque ingrédient seront déduites de l’inventaire (mouvement « Production »).</small></div>
    </div>`,
    submitLabel: 'Fabriquer et déduire du stock',
    onSubmit(d) {
      const qty = Number(d.qty) || 0;
      const shortages = [];
      for (const l of f.lines) {
        const ing = db.get('ingredients', l.ingredientId); if (!ing) continue;
        const need = gramsToUnit(qty * l.pct / 100, ing.unit);
        if ((Number(ing.stock) || 0) < need) shortages.push(`${ing.name} (besoin ${num(need, 3)} ${ing.unit}, stock ${num(ing.stock, 3)})`);
      }
      if (shortages.length && !confirm('Stock insuffisant pour :\n- ' + shortages.join('\n- ') + '\n\nContinuer quand même (le stock deviendra négatif) ?')) return false;
      let cost = 0;
      for (const l of f.lines) {
        const ing = db.get('ingredients', l.ingredientId); if (!ing) continue;
        const grams = qty * l.pct / 100;
        cost += grams * costPerGram(ing);
        recordMovement(ing.id, -gramsToUnit(grams, ing.unit), { type: 'production', reason: `Lot ${d.lot} — ${f.name}`, ref: f.code, date: d.date });
      }
      const batches = [...(f.batches || []), { id: Date.now().toString(36), date: d.date, qty, lot: d.lot, notes: d.notes, cost }];
      db.update('formulations', f.id, { batches });
      toast(`Lot ${d.lot} fabriqué, stock mis à jour`);
    }
  });
}

// ---------- Vues ----------
function renderList(el, ctx) {
  const q = ctx.params.q || '', st = ctx.params.status || '';
  let rows = db.all('formulations').slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  rows = rows.filter(r => matches(r, q, ['code', 'name', 'productType', 'objective', 'author']));
  if (st) rows = rows.filter(r => r.status === st);
  const all = db.all('formulations');
  const thisWeek = isoWeek(today()).key;
  const groups = new Map();
  for (const r of rows) { const k = r.weekKey || isoWeek(r.date).key; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }

  el.innerHTML = `
    <div class="stats">
      ${statCard('Formulations', all.length)}
      ${statCard('Cette semaine', all.filter(r => (r.weekKey || isoWeek(r.date).key) === thisWeek).length, isoWeek(today()).label)}
      ${statCard('En test', all.filter(r => r.status === 'En test').length, '', 'warn')}
      ${statCard('Validées', all.filter(r => r.status === 'Validée').length, '', 'good')}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Formulations R&D</h2><div class="subtitle">Journal hebdomadaire des essais de formulation</div></div>
        <div class="actions">
          ${all.some(f => f.importTag === ESSAIS_TAG) ? '' : '<button class="btn" data-import-essais title="Document « Calcul et quantités » : Booster Activation, Phase Transformante T1 à T4, Booster lipidique">Importer les essais du document</button>'}
          <button class="btn primary" data-new>+ Nouvelle formulation</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (code, nom, objectif…)" value="${esc(q)}">
        <select data-status><option value="">Tous les statuts</option>${STATUSES.map(x => `<option ${x === st ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>
      ${!rows.length ? `<div class="empty">${all.length ? 'Aucune formulation ne correspond.' : 'Aucune formulation. Créez d’abord vos ingrédients, puis votre première formulation.'}</div>` : ''}
      ${[...groups.entries()].map(([k, list]) => {
        const [y, w] = k.split('-S');
        return `<div class="week-head"><h3>Semaine ${parseInt(w, 10)} · ${y}${k === thisWeek ? ' (en cours)' : ''}</h3><span class="muted">${list.length} essai(s)</span></div>` + table({
          columns: [
            { label: 'Code', render: r => `<span class="strong">${esc(r.code)}</span><div class="muted">v${r.version || 1}${r.parentCode ? ' ← ' + esc(r.parentCode) : ''}</div>` },
            { label: 'Nom', render: r => `<div class="strong">${esc(r.name)}</div><div class="muted">${esc(r.productType || '')}</div>` },
            { label: 'Date', render: r => dateFmt(r.date) },
            { label: 'Ingrédients', align: 'num', render: r => (r.lines || []).length },
            { label: 'Total %', align: 'num', render: r => { const p = totalPct(r); return `<span class="${Math.abs(p - 100) < 0.01 ? 'pct-ok' : 'pct-bad'}">${num(p, 2)} %</span>`; } },
            { label: 'Coût / 100 g', align: 'num', render: r => money(formulationCost(r).per100g) },
            { label: 'Lots', align: 'num', render: r => (r.batches || []).length },
            { label: 'Statut', render: r => badge(r.status, STATUS_KIND[r.status] || 'grey') },
          ], rows: list, rowAttrs: r => `class="clickable" data-open="${r.id}"`
        });
      }).join('')}
    </div>`;
  const go = (patch) => ctx.navigate('formulations', '', { q, status: st, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-status]').addEventListener('change', e => go({ status: e.target.value }));
  el.querySelector('[data-import-essais]')?.addEventListener('click', () => importEssais(ctx.navigate));
  el.querySelector('[data-new]').addEventListener('click', () => {
    if (!db.all('ingredients').length) return toast('Créez d’abord des ingrédients dans l’inventaire.', 'warn');
    openFormulationForm(null, id => ctx.navigate('formulations', id));
  });
  el.addEventListener('click', e => { const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('formulations', tr.dataset.open); });
}

function renderDetail(el, ctx, f) {
  const batch = Number(f.batchSize) || 100;
  const cost = formulationCost(f);
  const pct = totalPct(f);
  const lines = (f.lines || []).slice().sort((a, b) => (a.phase || '').localeCompare(b.phase || ''));
  const versions = db.all('formulations').filter(x => x.id !== f.id && (x.parentCode === f.code || f.parentCode === x.code || (f.parentCode && x.parentCode === f.parentCode)));
  el.innerHTML = `
    <a href="${f.recipeId && db.get('recipes', f.recipeId) ? '#/formulations/fiche-' + f.recipeId : '#/formulations'}" class="back">← ${f.recipeId && db.get('recipes', f.recipeId) ? 'Retour à la fiche ' + esc(db.get('recipes', f.recipeId).name) : 'Retour aux formulations'}</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(f.name)} ${badge(f.status, STATUS_KIND[f.status] || 'grey')}</h2>
          <div class="subtitle">${esc(f.code)} · version ${f.version || 1} · ${esc(f.productType || '')} · ${dateFmt(f.date)} · ${isoWeek(f.date).label}${f.author ? ' · ' + esc(f.author) : ''}</div></div>
        <div class="actions">
          <button class="btn" data-print>Imprimer</button>
          <button class="btn" data-dup>Nouvelle version</button>
          <button class="btn" data-produce>Fabriquer un lot</button>
          <button class="btn" data-link title="Rattacher cette formulation à une fiche théorique du cahier de charge">${f.recipeId && db.get('recipes', f.recipeId) ? 'Changer de fiche' : 'Rattacher à une fiche'}</button>
          <button class="btn" data-edit>Modifier</button>
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      ${recipeLinkHtml(f) ? `<div class="info"><b>Fiche théorique :</b> ${recipeLinkHtml(f)}</div>` : ''}
      ${f.objective ? `<div class="info"><b>Objectif :</b> ${esc(f.objective)}</div>` : ''}
      ${Math.abs(pct - 100) > 0.01 ? `<div class="warnbox">La composition totalise ${num(pct, 3)} % au lieu de 100 %.</div>` : ''}
      <div class="stats">
        ${statCard('Lot de référence', num(batch, 0) + ' g')}
        ${statCard('Coût du lot', money(cost.total), cost.missing ? cost.missing + ' ingrédient(s) sans coût' : '')}
        ${statCard('Coût / 100 g', money(cost.per100g))}
        ${statCard('Lots fabriqués', (f.batches || []).length)}
      </div>
      <h3 style="margin-bottom:10px">Composition</h3>
      ${table({
        columns: [
          { label: 'Phase', render: l => badge(l.phase || '—', 'purple') },
          { label: 'Ingrédient', render: l => { const i = db.get('ingredients', l.ingredientId); return i ? `<a href="#/ingredients/${i.id}">${esc(i.name)}</a><div class="muted">${esc(i.inci || '')}</div>` : '<span class="muted">Ingrédient supprimé</span>'; } },
          { label: 'Fonction', key: 'role' },
          { label: '%', align: 'num', render: l => num(l.pct, 3) + ' %' },
          { label: `Qté pour ${num(batch, 0)} g`, align: 'num', render: l => num(batch * l.pct / 100, 3) + ' g' },
          { label: 'Coût', align: 'num', render: l => { const i = db.get('ingredients', l.ingredientId); return i ? money(batch * l.pct / 100 * costPerGram(i)) : '—'; } },
          { label: 'Stock dispo', align: 'num', render: l => { const i = db.get('ingredients', l.ingredientId); if (!i) return '—'; const need = gramsToUnit(batch * l.pct / 100, i.unit); const ok = (Number(i.stock) || 0) >= need; return `<span class="${ok ? '' : 'pct-bad'}">${num(i.stock, 3)} ${esc(i.unit)}</span>`; } },
        ], rows: lines
      })}
    </div>
    <div class="grid two">
      <div class="card">
        <h3 style="margin-bottom:10px">Mode opératoire</h3>
        ${stepsHtml(stepsOf(f))}
        <h3 style="margin:16px 0 10px">Observations et résultats</h3>
        <dl class="detail-grid">
          <div><dt>pH</dt><dd>${esc(f.ph || '—')}</dd></div>
          <div><dt>Viscosité / texture</dt><dd>${esc(f.viscosity || '—')}</dd></div>
          <div><dt>Aspect / odeur</dt><dd>${esc(f.aspect || '—')}</dd></div>
          <div><dt>Stabilité</dt><dd>${esc(f.stability || '—')}</dd></div>
        </dl>
        ${f.result ? `<h3 style="margin:16px 0 8px">Résultats des tests</h3><p style="white-space:pre-wrap">${esc(f.result)}</p>` : ''}
        <h3 style="margin:16px 0 8px">Commentaires pour la prochaine fois</h3>
        <p style="white-space:pre-wrap">${esc(f.notes || '—')}</p>
        <div class="card-head" style="margin:18px 0 8px"><h3>Tâches</h3><span class="muted">${esc(taskSummary(tasksOf(f.id)))}</span></div>
        <div data-tasks-list>${tasksHtml(tasksOf(f.id))}</div>
      </div>
      <div class="card reco-card">
        <div class="card-head"><h3><span class="reco-icon">⚗</span> Analyse de l’assistante chimiste</h3><div class="actions"><span class="muted" data-reco-date></span><button class="btn sm" data-reco-refresh title="Redemander une analyse à jour">Actualiser</button></div></div>
        <div class="md reco-body" data-reco></div>
        <div class="reco-thread" data-thread>${(f.thread || []).map(m => threadBubble(m)).join('')}</div>
        <form class="reco-composer" data-reco-form>
          <input name="q" placeholder="Pose une question sur cet essai, ou demande : « note les observations… », « écris les étapes… »" autocomplete="off">
          <button type="submit" class="chat-send reco-send" title="Envoyer" aria-label="Envoyer">➤</button>
        </form>
        <div class="muted" style="font-size:12px;margin-top:10px">L’assistante analyse la composition réellement faite, le mode opératoire et les observations consignées, en les comparant à la fiche théorique et aux autres versions. La discussion reste enregistrée sur cette formulation. Elle ne remplace ni les tests ni l’évaluation de sécurité.</div>
        ${(f.batches || []).length || versions.length ? `<div class="muted" style="font-size:12.5px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">${(f.batches || []).length ? `<b>Lots fabriqués :</b> ${f.batches.slice().reverse().map(b => `${esc(b.lot)} (${num(b.qty, 0)} g, ${dateFmt(b.date)})`).join(' · ')}` : ''}${(f.batches || []).length && versions.length ? '<br>' : ''}${versions.length ? `<b>Autres versions :</b> ${versions.map(v => `<a href="#/formulations/${v.id}">${esc(v.code)}</a> v${v.version || 1}`).join(' · ')}` : ''}</div>` : ''}
      </div>
    </div>`;
  const target = formulationTarget(f);
  loadRecommendation(target, el);
  el.querySelector('[data-reco-refresh]').addEventListener('click', () => loadRecommendation(target, el, { force: true }));
  wireThread(target, el, () => { const fresh = db.get('formulations', f.id); if (fresh) renderDetail(el, ctx, fresh); });
  el.querySelector('[data-edit]').addEventListener('click', () => openFormulationForm(f));
  wireTasksList(el.querySelector('[data-tasks-list]'));
  el.querySelector('[data-link]').addEventListener('click', () => {
    const recipes = db.all('recipes').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    openModal({
      title: 'Fiche théorique de référence',
      body: `<div class="form-grid">${field({ label: 'Fiche théorique (cahier de charge)', name: 'recipeId', type: 'select', options: [['', '— Aucune —'], ...recipes.map(r => [r.id, r.name])], value: f.recipeId || '', cols: 4, help: 'La formulation apparaîtra sous cette fiche, avec ses observations et ses commentaires.' })}</div>`,
      submitLabel: 'Enregistrer',
      onSubmit(d) { db.update('formulations', f.id, { recipeId: d.recipeId || '' }); toast(d.recipeId ? 'Formulation rattachée à la fiche' : 'Formulation détachée de sa fiche'); }
    });
  });
  el.querySelector('[data-dup]').addEventListener('click', () => openFormulationForm(null, id => ctx.navigate('formulations', id), { duplicateFrom: f }));
  el.querySelector('[data-produce]').addEventListener('click', () => openProduceForm(f, ctx));
  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer la formulation « ${f.code} — ${f.name} » ?`, { label: 'Supprimer' })) { db.remove('formulations', f.id); toast('Formulation supprimée'); ctx.navigate('formulations'); }
  });
}


// ---------- Recommandation de l'assistante chimiste (fiche théorique ou formulation réelle) ----------
import { ask, apiConfig, renderMarkdown } from '../chimiste.js';

const hash = (src) => { let h = 5381; for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0; return String(h); };

function recoFingerprint(r) {
  const essais = db.all('formulations').filter(f => f.recipeId === r.id).map(f => f.id + ':' + (f.updatedAt || '')).join('|');
  const stock = recipeLines(r).map(l => { const i = db.get('ingredients', l.ingredientId); return i ? `${i.id}=${i.stock}` : '?'; }).join('|');
  return hash(JSON.stringify(r.lines) + '#' + essais + '#' + stock);
}

const RECO_PROMPT = (r) => `Donne ta recommandation pour la fiche théorique « ${r.name} » avant le prochain essai au laboratoire. Appuie-toi uniquement sur le contexte ERP fourni (formule théorique, stock, formulations réelles déjà faites avec leurs observations et commentaires). Structure en quatre points courts avec des titres en gras : 1) Faisabilité avec le stock actuel (ingrédients manquants ou insuffisants pour un lot de 100 g) ; 2) Points de vigilance de la formule (plages d’usage, compatibilités, pH, ordre d’addition, température) ; 3) Ce que les essais précédents suggèrent (s’il n’y en a pas, dis-le en une phrase) ; 4) Proposition concrète pour le prochain essai (ajustements de % ou de procédé, et quoi mesurer). Maximum 250 mots, pas de préambule, pas de recherche web.`;

/** Analyse d'une formulation réelle : ce qui a été fait, comment, et ce qui a été observé. */
const ANALYSIS_PROMPT = (f) => `Analyse la formulation réelle « ${f.code} — ${f.name} » (version ${f.version || 1}) telle qu’elle a été faite au laboratoire. Appuie-toi uniquement sur le contexte ERP fourni : sa composition réelle, son mode opératoire, ses observations et résultats (pH, viscosité, aspect, stabilité, commentaires pour la prochaine fois), la fiche théorique de référence si elle existe et les autres versions. Structure en quatre points courts avec des titres en gras : 1) Composition réalisée (équilibre des phases, pourcentages hors plage d’usage, écarts par rapport à la fiche théorique ou à la version précédente et leur effet probable) ; 2) Mode opératoire (ordre d’addition, températures, émulsification, ce qui manque ou ce qui est risqué ; s’il n’est pas renseigné, dis-le en une phrase) ; 3) Lecture des observations et résultats (ce qu’ils indiquent sur la formule et le procédé ; s’il n’y en a pas encore, dis quoi mesurer en priorité) ; 4) Recommandations pour la prochaine version (ajustements concrets de % ou de procédé, et quoi contrôler). Maximum 300 mots, pas de préambule, pas de recherche web.`;

const recipeTarget = (r) => ({ col: 'recipes', rec: r, prompt: RECO_PROMPT, fp: recoFingerprint, askArgs: { recipeId: r.id } });
const formulationTarget = (f) => ({
  col: 'formulations', rec: f, prompt: ANALYSIS_PROMPT, askArgs: { formulationId: f.id, recipeId: f.recipeId || undefined },
  fp: (x) => {
    const ref = x.recipeId && db.get('recipes', x.recipeId);
    const versions = db.all('formulations').filter(o => o.id !== x.id && (o.parentCode === x.code || x.parentCode === o.code)).map(o => o.id + ':' + (o.updatedAt || '')).join('|');
    return hash(JSON.stringify([x.lines, stepsOf(x), x.ph, x.viscosity, x.aspect, x.stability, x.result, x.notes, x.objective, x.batchSize]) + '#' + (ref ? JSON.stringify([ref.lines, ref.steps]) : '') + '#' + versions);
  }
});

let recoRunning = null;
let quiet = 0;   // > 0 pendant les mises à jour silencieuses (recommandation, fil) : app.js ne re-rend pas la vue
export const quietUpdate = () => quiet > 0;
function saveQuiet(col, id, patch) { quiet++; try { return db.update(col, id, patch); } finally { quiet--; } }

async function loadRecommendation(target, el, { force = false } = {}) {
  const { col, rec: r } = target;
  const box = el.querySelector('[data-reco]'), when = el.querySelector('[data-reco-date]'), btn = el.querySelector('[data-reco-refresh]');
  if (!box) return;
  const cfg = apiConfig();
  if (!cfg.key) { box.innerHTML = `<div class="muted">Pour obtenir une recommandation, enregistre une clé API Claude dans <a href="#/settings">Paramètres → Assistante chimiste</a>.</div>`; return; }
  const fp = target.fp(r);
  const cached = r.reco;
  if (cached && cached.text && !force) {
    box.innerHTML = renderMarkdown(cached.text);
    when.textContent = (cached.fp === fp ? 'Générée le ' : 'À actualiser · générée le ') + new Date(cached.at).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
    if (cached.fp === fp) return;
  }
  if (recoRunning) recoRunning.abort();
  const ctrl = new AbortController(); recoRunning = ctrl;
  btn.disabled = true; when.textContent = 'Analyse en cours…';
  if (!cached || force) box.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  try {
    const res = await ask({ history: [{ role: 'user', content: target.prompt(r) }], ...target.askArgs, skill: 'chimiste', web: false, signal: ctrl.signal,
      onDelta: (_, acc) => { box.innerHTML = renderMarkdown(acc); } });
    if (ctrl.signal.aborted) return;
    box.innerHTML = renderMarkdown(res.text);
    const reco = { text: res.text, at: new Date().toISOString(), fp };
    try { saveQuiet(col, r.id, { reco }); r.reco = reco; } catch (_) { /* lecture seule : pas de mémorisation */ }
    when.textContent = 'Générée à l’instant';
  } catch (e) {
    if (e.name !== 'AbortError') { box.innerHTML = `<div class="warnbox" style="margin:0">${esc(e.message || 'Erreur')}</div>`; when.textContent = ''; }
  } finally { if (recoRunning === ctrl) recoRunning = null; btn.disabled = false; }
}

/** Fil de discussion enregistré sur la fiche ou la formulation (`thread`), avec les outils de l'assistante. */
function wireThread(target, el, onAction) {
  const { col, rec: r } = target;
  const thread = el.querySelector('[data-thread]'), rform = el.querySelector('[data-reco-form]');
  if (!thread || !rform) return;
  rform.addEventListener('submit', async e => {
    e.preventDefault();
    const q = rform.q.value.trim(); if (!q) return;
    if (!apiConfig().key) return toast('Enregistre d’abord une clé API dans Paramètres → Assistante chimiste.', 'warn');
    rform.q.value = ''; rform.q.disabled = true;
    const now = new Date().toISOString();
    const msgs = [...(r.thread || []), { role: 'user', content: q, at: now, by: whoami()?.name || '' }];
    try { saveQuiet(col, r.id, { thread: msgs }); r.thread = msgs; } catch (_) { /* lecture seule */ }
    thread.insertAdjacentHTML('beforeend', threadBubble(msgs[msgs.length - 1]));
    const holder = document.createElement('div'); holder.className = 'msg assistant'; holder.innerHTML = `<div class="msg-avatar">⚗</div><div><div class="msg-body md"><span class="typing"><i></i><i></i><i></i></span></div><div class="msg-time"></div></div>`;
    thread.appendChild(holder); holder.scrollIntoView({ block: 'nearest' });
    const body = holder.querySelector('.msg-body');
    let full = '', acted = false;
    try {
      const res = await ask({ history: msgs.map(m => ({ role: m.role, content: m.content })), ...target.askArgs, skill: 'chimiste', tools: true, onDelta: (_, acc) => { full = acc; body.innerHTML = renderMarkdown(acc); },
        onAction: (a) => { if (a.ok) acted = true; } });
      full = res.text || full; body.innerHTML = renderMarkdown(full);
    } catch (err) { body.innerHTML = `<div class="warnbox" style="margin:0">${esc(err.message || 'Erreur')}</div>`; full = ''; }
    finally {
      rform.q.disabled = false; rform.q.focus();
      holder.querySelector('.msg-time').textContent = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
      if (full) { const all = [...(db.get(col, r.id)?.thread || msgs), { role: 'assistant', content: full, at: new Date().toISOString() }]; try { saveQuiet(col, r.id, { thread: all }); r.thread = all; } catch (_) { /* lecture seule */ } }
      if (acted && onAction) onAction();
    }
  });
}

function threadBubble(m) {
  const t = m.at ? new Date(m.at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '';
  if (m.role === 'user') return `<div class="msg user"><div class="msg-body">${esc(m.content)}</div><div class="msg-time">${esc(m.by || '')} · ${t}</div></div>`;
  return `<div class="msg assistant"><div class="msg-avatar">⚗</div><div><div class="msg-body md">${renderMarkdown(m.content)}</div><div class="msg-time">${t}</div></div></div>`;
}
function recipeLinkHtml(f) {
  const r = f.recipeId ? db.get('recipes', f.recipeId) : null;
  return r ? `<a href="#/formulations/fiche-${r.id}">${esc(r.name)}</a>` : '';
}

function renderRecipes(el, ctx) {
  ensureRecipes();
  const recipes = db.all('recipes').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const forms = db.all('formulations');
  const byRecipe = (id) => forms.filter(f => f.recipeId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const orphans = forms.filter(f => !f.recipeId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const me = whoami()?.id;
  const tasks = openTasks().sort((a, b) => ((a.assigneeId === me) === (b.assigneeId === me) ? 0 : a.assigneeId === me ? -1 : 1) || (a.due || '9999').localeCompare(b.due || '9999'));
  const mine = tasks.filter(t => t.assigneeId === me);
  const card = (r) => {
    const list = byRecipe(r.id); const last = list[0];
    return `<a href="#/formulations/fiche-${r.id}" class="recipe-card phase-${r.phase}">
      <div class="recipe-tags"><span class="badge ${r.phase === 'T' ? 'purple' : 'green'}">${esc(r.bottle)}</span></div>
      <div class="recipe-name">${esc(r.name)}</div>
      <div class="recipe-foot"><span>${list.length} formulation${list.length > 1 ? 's' : ''} réelle${list.length > 1 ? 's' : ''}</span>${last ? badge(last.status, STATUS_KIND[last.status] || 'grey') : '<span class="muted">aucun essai</span>'}</div>
    </a>`;
  };
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Fiches théoriques de la gamme</h2></div>
      <div class="actions">
        ${forms.some(f => f.importTag === ESSAIS_TAG) ? '' : '<button class="btn" data-import-essais title="Document « Calcul et quantités » : Booster Activation, Phase Transformante T1 à T4, Booster lipidique">Importer les essais du document</button>'}
        <button class="btn primary" data-new>+ Formulation libre</button>
      </div>
    </div>
    ${tasks.length ? `<div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Tâches à faire</h3><span class="muted">${mine.length ? `${mine.length} pour moi · ` : ''}${tasks.length} en tout</span></div>
      <div data-tasks-list>${tasksHtml(tasks.slice(0, 8), { showFormulation: true })}</div>
    </div>` : ''}
    ${['T', 'N'].map(ph => `<div class="week-head"><h3>${esc(PHASE_LABEL[ph])}</h3></div><div class="recipe-grid">${recipes.filter(r => r.phase === ph).map(card).join('')}</div>`).join('')}
    ${orphans.length ? `<div class="card" style="margin-top:22px">
      <div class="card-head"><h3>Formulations sans fiche théorique</h3><span class="muted">${orphans.length} essai(s) · rattache-les à une fiche via « Modifier »</span></div>
      ${formTable(orphans)}
    </div>` : ''}`;
  el.querySelector('[data-import-essais]')?.addEventListener('click', () => importEssais(ctx.navigate));
  wireTasksList(el.querySelector('[data-tasks-list]'));
  el.querySelector('[data-new]').addEventListener('click', () => {
    if (!db.all('ingredients').length) return toast('Créez d’abord des ingrédients dans l’inventaire.', 'warn');
    openFormulationForm(null, id => ctx.navigate('formulations', id));
  });
  el.addEventListener('click', e => { const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('formulations', tr.dataset.open); });
}

function formTable(list) {
  return table({
    columns: [
      { label: 'Code', render: r => `<span class="strong">${esc(r.code)}</span><div class="muted">v${r.version || 1}${r.parentCode ? ' ← ' + esc(r.parentCode) : ''}</div>` },
      { label: 'Nom', render: r => `<div class="strong">${esc(r.name)}</div><div class="muted">${esc(r.author || '')}</div>` },
      { label: 'Date', render: r => dateFmt(r.date) },
      { label: 'Total %', align: 'num', render: r => { const p = totalPct(r); return `<span class="${Math.abs(p - 100) < 0.01 ? 'pct-ok' : 'pct-bad'}">${num(p, 2)} %</span>`; } },
      { label: 'Tâches', render: r => { const t = tasksOf(r.id); return t.length ? `<span class="muted">${esc(taskSummary(t))}</span>` : '<span class="muted">—</span>'; } },
      { label: 'Prochaine fois', render: r => `<span class="muted">${esc((r.notes || '').slice(0, 90))}${(r.notes || '').length > 90 ? '…' : ''}</span>` },
      { label: 'Statut', render: r => badge(r.status, STATUS_KIND[r.status] || 'grey') },
    ], rows: list, rowAttrs: r => `class="clickable" data-open="${r.id}"`, empty: 'Aucune formulation réelle pour cette fiche. Clique sur « Créer une formulation » pour commencer.'
  });
}

let refreshRecipeView = () => {};
function renderRecipe(el, ctx, r) {
  refreshRecipeView = () => { const fresh = db.get('recipes', r.id); if (!fresh) return; const sv = el.querySelector('[data-steps-view]'); if (sv) { r.steps = fresh.steps || []; sv.innerHTML = stepsHtml(r.steps, { editable: true }); } const list = db.all('formulations').filter(f => f.recipeId === r.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')); const lt = el.querySelector('[data-real-list]'); if (lt) lt.innerHTML = formTable(list); };
  const lines = recipeLines(r);
  const list = db.all('formulations').filter(f => f.recipeId === r.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  el.innerHTML = `
    <a href="#/formulations" class="back">← Toutes les fiches</a>
    <div class="card">
      <div class="page-head">
        <div><div class="recipe-tags" style="margin-bottom:6px"><span class="badge ${r.phase === 'T' ? 'purple' : 'green'}">${esc(PHASE_LABEL[r.phase] || r.phase)}</span></div>
          <h2>${esc(r.name)}</h2></div>
        <div class="actions"><button class="btn primary" data-create>+ Créer une formulation à partir de cette fiche</button></div>
      </div>
      <h3 style="margin-bottom:10px">Formule théorique (pour 100 g)</h3>
      ${table({
        columns: [
          { label: 'Phase', render: l => badge(l.phase, 'purple') },
          { label: 'Ingrédient', render: l => { const i = db.get('ingredients', l.ingredientId); return i ? `<a href="#/ingredients/${i.id}">${esc(i.name)}</a>` : '—'; } },
          { label: 'INCI', render: l => `<span class="muted">${esc(db.get('ingredients', l.ingredientId)?.inci || '')}</span>` },
          { label: 'Rôle', key: 'role' },
          { label: '%', align: 'num', render: l => num(l.pct, 2) + ' %' },
          { label: 'Quantité pour 100 g', align: 'num', render: l => num(l.pct, 2) + ' g' },
        ], rows: lines
      })}
    </div>
    <div class="card">
      <div class="card-head"><h3>Mode opératoire</h3><span class="muted">Clique une étape pour la modifier · ✕ pour la retirer</span></div>
      <div data-steps-view>${stepsHtml(r.steps || [], { editable: true })}</div>
      <form class="step-add" data-step-add><input name="step" placeholder="Nouvelle étape… (Entrée pour ajouter)"><button type="submit" class="btn sm">+ Ajouter</button></form>
    </div>
    <div class="card reco-card">
      <div class="card-head"><h3><span class="reco-icon">⚗</span> Recommandation de l’assistante chimiste</h3><div class="actions"><span class="muted" data-reco-date></span><button class="btn sm" data-reco-refresh title="Redemander une recommandation à jour">Actualiser</button></div></div>
      <div class="md reco-body" data-reco></div>
      <div class="reco-thread" data-thread>${(r.thread || []).map(m => threadBubble(m)).join('')}</div>
      <form class="reco-composer" data-reco-form>
        <input name="q" placeholder="Pose une question, ou demande : « crée une formulation avec… », « écris les étapes… », « note les observations… »" autocomplete="off">
        <button type="submit" class="chat-send reco-send" title="Envoyer" aria-label="Envoyer">➤</button>
      </form>
      <div class="muted" style="font-size:12px;margin-top:10px">L’assistante voit la formule théorique, le mode opératoire, les formulations réelles rattachées et leurs observations. La discussion reste enregistrée sur cette fiche. Elle ne remplace ni les tests ni l’évaluation de sécurité.</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Formulations réelles</h3><span class="muted">Chaque essai garde ses observations, ses résultats et les commentaires pour la prochaine fois.</span></div>
      <div data-real-list>${formTable(list)}</div>
    </div>`;
  const target = recipeTarget(r);
  loadRecommendation(target, el);
  el.querySelector('[data-reco-refresh]').addEventListener('click', () => loadRecommendation(target, el, { force: true }));
  wireThread(target, el, refreshRecipeView);
  // Étapes du mode opératoire
  const stepsView = el.querySelector('[data-steps-view]');
  const saveSteps = (steps) => { db.update('recipes', r.id, { steps }); r.steps = steps; stepsView.innerHTML = stepsHtml(steps, { editable: true }); };
  el.querySelector('[data-step-add]').addEventListener('submit', e => { e.preventDefault(); const inp = e.target.step; const t = inp.value.trim(); if (!t) return; saveSteps([...(r.steps || []), t]); inp.value = ''; });
  stepsView.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove-step]'); if (rm) { const steps = (r.steps || []).slice(); steps.splice(+rm.dataset.removeStep, 1); saveSteps(steps); return; }
    const ed = e.target.closest('[data-edit-step]');
    if (ed) { const i = +ed.dataset.editStep; openModal({ title: `Étape ${i + 1}`, body: `<div class="form-grid">${field({ label: 'Texte de l’étape', name: 'text', type: 'textarea', rows: 3, value: r.steps[i], required: true, cols: 4 })}</div>`, onSubmit(d) { const steps = r.steps.slice(); steps[i] = d.text.trim(); saveSteps(steps); } }); }
  });
  // Base de la nouvelle formulation : formule théorique de la fiche, ou ingrédients + mode opératoire d'une version réelle existante.
  const create = () => {
    const real = db.all('formulations').filter(f => f.recipeId === r.id).sort((a, b) => (Number(a.version) || 1) - (Number(b.version) || 1) || (a.date || '').localeCompare(b.date || ''));
    const open = (fromFormulation) => openFormulationForm(null, id => ctx.navigate('formulations', id), { fromRecipe: r, fromFormulation });
    if (!real.length) return open(null);
    const option = (value, title, sub, checked) => `<label class="choice"><input type="radio" name="source" value="${esc(value)}" ${checked ? 'checked' : ''}><span><span class="choice-title">${title}</span><span class="choice-sub">${sub}</span></span></label>`;
    openModal({
      title: 'Sur quelle base créer la formulation ?',
      body: `<p class="muted" style="margin:0 0 10px">Les ingrédients et le mode opératoire seront préremplis à partir de la base choisie ; tu pourras tout modifier avant d’enregistrer.</p>
        <div class="choice-list">
          ${option('recipe', 'Formule théorique de la fiche', `${lines.length} ingrédient(s) · ${(r.steps || []).length} étape(s)`, true)}
          ${real.map(f => option(f.id, `${esc(f.code)} · v${f.version || 1}${f.status ? ' · ' + esc(f.status) : ''}`, `${dateFmt(f.date)} · ${(f.lines || []).length} ingrédient(s) · ${stepsOf(f).length} étape(s)${f.author ? ' · ' + esc(f.author) : ''}`)).join('')}
        </div>`,
      submitLabel: 'Continuer',
      onSubmit(d) { open(d.source && d.source !== 'recipe' ? db.get('formulations', d.source) : null); }
    });
  };
  el.querySelector('[data-create]').addEventListener('click', create);
  el.addEventListener('click', e => { const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('formulations', tr.dataset.open); });
}

export default {
  quietUpdate,
  title: 'Formulations',
  render(el, ctx) {
    ensureRecipes();
    if (ctx.id && ctx.id.startsWith('fiche-')) { const r = db.get('recipes', ctx.id.slice(6)); if (r) return renderRecipe(el, ctx, r); }
    if (ctx.id === 'liste') return renderList(el, ctx);
    if (ctx.id) { const f = db.get('formulations', ctx.id); if (f) return renderDetail(el, ctx, f); }
    renderRecipes(el, ctx);
  }
};
