// Formulations R&D : recettes hebdomadaires, composition en %, coût, fabrication de lots.
import { db } from '../store.js';
import { esc, money, num, dateFmt, today, isoWeek, toast, badge, openModal, confirmDialog, field, table, matches, statCard, costPerGram, gramsToUnit } from '../ui.js';
import { recordMovement } from './ingredients.js';
import { importEssais, ESSAIS_TAG } from '../essais.js';
import { currentUser } from '../auth.js';
import { ensureRecipes, recipeLines, PHASE_LABEL } from '../recettes.js';

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

// ---------- Éditeur ----------
function lineRow(l = {}, ingredients) {
  const opts = ['<option value="">— Choisir —</option>', ...ingredients.map(i => `<option value="${i.id}" data-cost="${costPerGram(i)}" ${i.id === l.ingredientId ? 'selected' : ''}>${esc(i.name)}${i.inci ? ' (' + esc(i.inci) + ')' : ''}</option>`)].join('');
  return `<tr data-repeat-row>
    <td style="width:70px"><select name="phase">${PHASES.map(p => `<option ${p === (l.phase || 'A') ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
    <td><select name="ingredientId">${opts}</select></td>
    <td style="width:110px"><input name="pct" type="number" step="0.001" min="0" max="100" value="${l.pct ?? ''}" placeholder="%"></td>
    <td style="width:120px" class="num" data-qty>—</td>
    <td style="width:110px" class="num" data-cost>—</td>
    <td><input name="role" value="${esc(l.role || '')}" placeholder="Fonction"></td>
    <td style="width:40px"><button type="button" class="icon-btn del" data-del-line title="Retirer">✕</button></td>
  </tr>`;
}

export function openFormulationForm(existing, onDone, { duplicateFrom, fromRecipe } = {}) {
  const s = db.settings();
  const recipes = db.all('recipes').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const fromR = fromRecipe ? { code: nextCode(today()), date: today(), version: db.all('formulations').filter(x => x.recipeId === fromRecipe.id).length + 1, status: STATUSES[0], productType: 'Traitement lissant', batchSize: 100, recipeId: fromRecipe.id, name: fromRecipe.name, objective: fromRecipe.description || '', lines: recipeLines(fromRecipe).map(l => ({ phase: l.phase, ingredientId: l.ingredientId, pct: l.pct, role: l.role })) } : null;
  const ingredients = db.all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name));
  const base = duplicateFrom ? { ...duplicateFrom, id: undefined, code: nextCode(today()), date: today(), version: (Number(duplicateFrom.version) || 1) + 1, status: 'En développement', parentCode: duplicateFrom.code, result: '', notes: '' } : null;
  const f = base || fromR || existing || { code: nextCode(today()), date: today(), version: 1, status: STATUSES[0], productType: s.productTypes[0], batchSize: 100, lines: [{ phase: 'A' }, { phase: 'A' }, { phase: 'B' }] };
  const m = openModal({
    title: fromR ? `Nouvelle formulation — ${fromRecipe.name}` : base ? `Nouvelle version de ${duplicateFrom.code}` : existing ? 'Modifier la formulation' : 'Nouvelle formulation', wide: true,
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
        <table><thead><tr><th>Phase</th><th>Ingrédient</th><th>%</th><th class="num">Qté (g)</th><th class="num">Coût</th><th>Fonction</th><th></th></tr></thead>
        <tbody data-lines>${(f.lines || []).map(l => lineRow(l, ingredients)).join('')}</tbody></table>
        <div class="lines-foot"><button type="button" class="btn sm" data-add-line>+ Ajouter une ligne</button><span>Total : <b data-total-pct>0</b> % · Coût du lot : <b data-total-cost>0</b> · <span data-per100></span></span></div>
      </div>
      <div class="form-section">Mode opératoire, observations et résultats</div>
      ${field({ label: 'Mode opératoire (étapes de fabrication)', name: 'procedure', type: 'textarea', rows: 4, value: f.procedure, cols: 4, placeholder: 'Phase A : chauffer à 75 °C… Phase B : …' })}
      ${field({ label: 'pH', name: 'ph', value: f.ph, cols: 1 })}
      ${field({ label: 'Viscosité / texture', name: 'viscosity', value: f.viscosity, cols: 1 })}
      ${field({ label: 'Aspect / odeur', name: 'aspect', value: f.aspect, cols: 1 })}
      ${field({ label: 'Stabilité', name: 'stability', value: f.stability, cols: 1, placeholder: 'ex. Stable 4 sem. à 40 °C' })}
      ${field({ label: 'Résultats des tests (cheveux, salon, panel)', name: 'result', type: 'textarea', rows: 3, value: f.result, cols: 4 })}
      ${field({ label: 'Commentaires pour la prochaine fois', name: 'notes', type: 'textarea', rows: 2, value: f.notes, cols: 4, placeholder: 'ex. Réduire le BTMS-50 à 3 %, mesurer le pH à froid, lancer le test 40 °C' })}
      ${field({ label: 'Formulateur·rice', name: 'author', value: f.author || (existing ? '' : currentUser()?.name || ''), cols: 2 })}
    </div>`,
    submitLabel: existing ? 'Enregistrer' : 'Créer la formulation',
    onSubmit(data, { form }) {
      const lines = readLines(form);
      if (!lines.length) { toast('Ajoutez au moins un ingrédient.', 'warn'); return false; }
      data.lines = lines; data.batchSize = Number(data.batchSize) || 100; data.version = Number(data.version) || 1;
      data.weekKey = isoWeek(data.date).key;
      if (existing) { db.update('formulations', existing.id, data); toast('Formulation mise à jour'); onDone && onDone(existing.id); }
      else { if (base) data.parentCode = base.parentCode; const rec = db.insert('formulations', data); toast('Formulation créée'); onDone && onDone(rec.id); }
    }
  });
  const form = m.form;
  const tbody = form.querySelector('[data-lines]');
  const recalc = () => {
    const batch = Number(form.querySelector('[name=batchSize]').value) || 100;
    let pct = 0, cost = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      const p = Number(tr.querySelector('[name=pct]').value) || 0;
      const opt = tr.querySelector('[name=ingredientId]').selectedOptions[0];
      const cpg = Number(opt?.dataset.cost) || 0;
      const grams = batch * p / 100;
      tr.querySelector('[data-qty]').textContent = num(grams, 3) + ' g';
      tr.querySelector('[data-cost]').textContent = money(grams * cpg);
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
    tbody.insertAdjacentHTML('beforeend', lineRow({ phase: last }, ingredients)); recalc();
  });
  form.addEventListener('click', e => { const b = e.target.closest('[data-del-line]'); if (b) { b.closest('tr').remove(); recalc(); } });
  recalc();
}

function readLines(form) {
  return [...form.querySelectorAll('[data-repeat-row]')].map(tr => ({
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
        <p style="white-space:pre-wrap">${esc(f.procedure || 'Non renseigné.')}</p>
        <h3 style="margin:16px 0 10px">Observations et résultats</h3>
        <dl class="detail-grid">
          <div><dt>pH</dt><dd>${esc(f.ph || '—')}</dd></div>
          <div><dt>Viscosité / texture</dt><dd>${esc(f.viscosity || '—')}</dd></div>
          <div><dt>Aspect / odeur</dt><dd>${esc(f.aspect || '—')}</dd></div>
          <div><dt>Stabilité</dt><dd>${esc(f.stability || '—')}</dd></div>
        </dl>
        <h3 style="margin:16px 0 8px">Résultats des tests</h3>
        <p style="white-space:pre-wrap">${esc(f.result || 'Aucun résultat consigné.')}</p>
        <h3 style="margin:16px 0 8px">Commentaires pour la prochaine fois</h3>
        <p style="white-space:pre-wrap">${esc(f.notes || '—')}</p>
      </div>
      <div class="card">
        <h3 style="margin-bottom:10px">Lots fabriqués</h3>
        ${table({
          columns: [
            { label: 'Date', render: b => dateFmt(b.date) },
            { label: 'Lot', key: 'lot' },
            { label: 'Quantité', align: 'num', render: b => num(b.qty, 0) + ' g' },
            { label: 'Coût', align: 'num', render: b => money(b.cost) },
            { label: 'Remarques', key: 'notes' },
          ], rows: (f.batches || []).slice().reverse(), empty: 'Aucun lot fabriqué pour cette formulation.'
        })}
        <h3 style="margin:16px 0 10px">Autres versions</h3>
        ${table({
          columns: [
            { label: 'Code', render: v => `<a href="#/formulations/${v.id}">${esc(v.code)}</a>` },
            { label: 'Version', align: 'num', render: v => 'v' + (v.version || 1) },
            { label: 'Date', render: v => dateFmt(v.date) },
            { label: 'Statut', render: v => badge(v.status, STATUS_KIND[v.status] || 'grey') },
          ], rows: versions, empty: 'Aucune autre version liée.'
        })}
      </div>
    </div>`;
  el.querySelector('[data-edit]').addEventListener('click', () => openFormulationForm(f));
  el.querySelector('[data-dup]').addEventListener('click', () => openFormulationForm(null, id => ctx.navigate('formulations', id), { duplicateFrom: f }));
  el.querySelector('[data-produce]').addEventListener('click', () => openProduceForm(f, ctx));
  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer la formulation « ${f.code} — ${f.name} » ?`, { label: 'Supprimer' })) { db.remove('formulations', f.id); toast('Formulation supprimée'); ctx.navigate('formulations'); }
  });
}


// ---------- Recommandation de l'assistante chimiste sur une fiche théorique ----------
import { ask, apiConfig, renderMarkdown } from '../chimiste.js';

function recoFingerprint(r) {
  const essais = db.all('formulations').filter(f => f.recipeId === r.id).map(f => f.id + ':' + (f.updatedAt || '')).join('|');
  const stock = recipeLines(r).map(l => { const i = db.get('ingredients', l.ingredientId); return i ? `${i.id}=${i.stock}` : '?'; }).join('|');
  const src = JSON.stringify(r.lines) + '#' + essais + '#' + stock;
  let h = 5381; for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return String(h);
}

const RECO_PROMPT = (r) => `Donne ta recommandation pour la fiche théorique « ${r.name} » avant le prochain essai au laboratoire. Appuie-toi uniquement sur le contexte ERP fourni (formule théorique, stock, formulations réelles déjà faites avec leurs observations et commentaires). Structure en quatre points courts avec des titres en gras : 1) Faisabilité avec le stock actuel (ingrédients manquants ou insuffisants pour un lot de 100 g) ; 2) Points de vigilance de la formule (plages d’usage, compatibilités, pH, ordre d’addition, température) ; 3) Ce que les essais précédents suggèrent (s’il n’y en a pas, dis-le en une phrase) ; 4) Proposition concrète pour le prochain essai (ajustements de % ou de procédé, et quoi mesurer). Maximum 250 mots, pas de préambule, pas de recherche web.`;

let recoRunning = null;
async function loadRecommendation(r, el, { force = false } = {}) {
  const box = el.querySelector('[data-reco]'), when = el.querySelector('[data-reco-date]'), btn = el.querySelector('[data-reco-refresh]');
  if (!box) return;
  const cfg = apiConfig();
  if (!cfg.key) { box.innerHTML = `<div class="muted">Pour obtenir une recommandation, enregistre une clé API Claude dans <a href="#/settings">Paramètres → Assistante chimiste</a>.</div>`; return; }
  const fp = recoFingerprint(r);
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
    const res = await ask({ history: [{ role: 'user', content: RECO_PROMPT(r) }], recipeId: r.id, skill: 'chimiste', web: false, signal: ctrl.signal,
      onDelta: (_, acc) => { box.innerHTML = renderMarkdown(acc); } });
    if (ctrl.signal.aborted) return;
    box.innerHTML = renderMarkdown(res.text);
    const reco = { text: res.text, at: new Date().toISOString(), fp };
    try { db.update('recipes', r.id, { reco }); r.reco = reco; } catch (_) { /* lecture seule : pas de mémorisation */ }
    when.textContent = 'Générée à l’instant';
  } catch (e) {
    if (e.name !== 'AbortError') { box.innerHTML = `<div class="warnbox" style="margin:0">${esc(e.message || 'Erreur')}</div>`; when.textContent = ''; }
  } finally { if (recoRunning === ctrl) recoRunning = null; btn.disabled = false; }
}

// ---------- Fiches théoriques (cahier de charge) ----------
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
  const card = (r) => {
    const list = byRecipe(r.id); const last = list[0];
    return `<a href="#/formulations/fiche-${r.id}" class="recipe-card phase-${r.phase}">
      <div class="recipe-tags"><span class="badge ${r.phase === 'T' ? 'purple' : 'green'}">${esc(r.bottle)}</span><span class="badge">${esc(r.variant)}</span></div>
      <div class="recipe-name">${esc(r.name)}</div>
      <div class="recipe-desc">${esc((r.description || '').slice(0, 120))}${(r.description || '').length > 120 ? '…' : ''}</div>
      <div class="recipe-foot"><span>${list.length} formulation${list.length > 1 ? 's' : ''} réelle${list.length > 1 ? 's' : ''}</span>${last ? badge(last.status, STATUS_KIND[last.status] || 'grey') : '<span class="muted">aucun essai</span>'}</div>
    </a>`;
  };
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Fiches théoriques de la gamme</h2><div class="subtitle">Cahier de charge DermaGen v1.0 · Choisis une fiche pour voir la formule de référence et créer une formulation réelle à partir d’elle.</div></div>
      <div class="actions">
        ${forms.some(f => f.importTag === ESSAIS_TAG) ? '' : '<button class="btn" data-import-essais title="Document « Calcul et quantités » : Booster Activation, Phase Transformante T1 à T4, Booster lipidique">Importer les essais du document</button>'}
        <button class="btn primary" data-new>+ Formulation libre</button>
      </div>
    </div>
    ${['T', 'N'].map(ph => `<div class="week-head"><h3>${esc(PHASE_LABEL[ph])}</h3></div><div class="recipe-grid">${recipes.filter(r => r.phase === ph).map(card).join('')}</div>`).join('')}
    ${orphans.length ? `<div class="card" style="margin-top:22px">
      <div class="card-head"><h3>Formulations sans fiche théorique</h3><span class="muted">${orphans.length} essai(s) · rattache-les à une fiche via « Modifier »</span></div>
      ${formTable(orphans)}
    </div>` : ''}`;
  el.querySelector('[data-import-essais]')?.addEventListener('click', () => importEssais(ctx.navigate));
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
      { label: 'Résultat', render: r => `<span class="muted">${esc((r.result || '').slice(0, 90))}${(r.result || '').length > 90 ? '…' : ''}</span>` },
      { label: 'Prochaine fois', render: r => `<span class="muted">${esc((r.notes || '').slice(0, 90))}${(r.notes || '').length > 90 ? '…' : ''}</span>` },
      { label: 'Statut', render: r => badge(r.status, STATUS_KIND[r.status] || 'grey') },
    ], rows: list, rowAttrs: r => `class="clickable" data-open="${r.id}"`, empty: 'Aucune formulation réelle pour cette fiche. Clique sur « Créer une formulation » pour commencer.'
  });
}

function renderRecipe(el, ctx, r) {
  const lines = recipeLines(r);
  const list = db.all('formulations').filter(f => f.recipeId === r.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  el.innerHTML = `
    <a href="#/formulations" class="back">← Toutes les fiches</a>
    <div class="card">
      <div class="page-head">
        <div><div class="recipe-tags" style="margin-bottom:6px"><span class="badge ${r.phase === 'T' ? 'purple' : 'green'}">${esc(PHASE_LABEL[r.phase] || r.phase)}</span><span class="badge">${esc(r.bottle)} · ${esc(r.variant)}</span></div>
          <h2>${esc(r.name)}</h2><div class="subtitle">Fiche théorique · cahier de charge v1.0 · ${list.length} formulation${list.length > 1 ? 's' : ''} réelle${list.length > 1 ? 's' : ''}</div></div>
        <div class="actions"><button class="btn primary" data-create>+ Créer une formulation à partir de cette fiche</button></div>
      </div>
      ${r.description ? `<p style="margin:0 0 10px">${esc(r.description)}</p>` : ''}
      ${r.usage ? `<div class="info"><b>Utilisation :</b> ${esc(r.usage)}</div>` : ''}
      ${r.warning ? `<div class="warnbox">${esc(r.warning)}</div>` : ''}
      <h3 style="margin-bottom:10px">Formule théorique (pour 100 g)</h3>
      ${table({
        columns: [
          { label: 'Phase', render: l => badge(l.phase, 'purple') },
          { label: 'Ingrédient', render: l => { const i = db.get('ingredients', l.ingredientId); return i ? `<a href="#/ingredients/${i.id}">${esc(i.name)}</a>` : '—'; } },
          { label: 'INCI', render: l => `<span class="muted">${esc(db.get('ingredients', l.ingredientId)?.inci || '')}</span>` },
          { label: 'Rôle', key: 'role' },
          { label: '%', align: 'num', render: l => num(l.pct, 2) + ' %' },
          { label: 'Quantité pour 100 g', align: 'num', render: l => num(l.pct, 2) + ' g' },
          { label: 'Stock', align: 'num', render: l => { const i = db.get('ingredients', l.ingredientId); if (!i) return '—'; const ok = (Number(i.stock) || 0) > 0; return `<span class="${ok ? '' : 'pct-bad'}">${num(i.stock, 3)} ${esc(i.unit)}</span>`; } },
        ], rows: lines
      })}
    </div>
    <div class="card reco-card">
      <div class="card-head"><h3><span class="reco-icon">⚗</span> Recommandation de l’assistante chimiste</h3><div class="actions"><span class="muted" data-reco-date></span><button class="btn sm" data-reco-refresh title="Redemander une recommandation à jour">Actualiser</button></div></div>
      <div class="md reco-body" data-reco></div>
      <div class="muted" style="font-size:12px;margin-top:10px">Recommandation générée par l’IA à partir de la fiche, du stock et des essais précédents. Elle ne remplace ni les tests ni l’évaluation de sécurité. Pour approfondir, pose la question dans <a href="#/chat">Assistante chimiste</a>.</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Formulations réelles</h3><span class="muted">Chaque essai garde ses observations, ses résultats et les commentaires pour la prochaine fois.</span></div>
      ${formTable(list)}
    </div>`;
  loadRecommendation(r, el);
  el.querySelector('[data-reco-refresh]').addEventListener('click', () => loadRecommendation(r, el, { force: true }));
  const create = () => openFormulationForm(null, id => ctx.navigate('formulations', id), { fromRecipe: r });
  el.querySelector('[data-create]').addEventListener('click', create);
  el.addEventListener('click', e => { const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('formulations', tr.dataset.open); });
}

export default {
  title: 'Formulations',
  render(el, ctx) {
    ensureRecipes();
    if (ctx.id && ctx.id.startsWith('fiche-')) { const r = db.get('recipes', ctx.id.slice(6)); if (r) return renderRecipe(el, ctx, r); }
    if (ctx.id === 'liste') return renderList(el, ctx);
    if (ctx.id) { const f = db.get('formulations', ctx.id); if (f) return renderDetail(el, ctx, f); }
    renderRecipes(el, ctx);
  }
};
