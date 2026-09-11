// Inventaire des ingrédients : fiches, stock, mouvements, alertes.
import { db } from '../store.js';
import { esc, money, num, dateFmt, today, daysUntil, toast, badge, openModal, confirmDialog, field, table, matches, download, toCSV, statCard, costPerGram } from '../ui.js';

export const MOVEMENT_TYPES = { entree: 'Entrée', sortie: 'Sortie', ajustement: 'Ajustement', production: 'Production (formulation)', reception: 'Réception (commande)' };

/** Enregistre un mouvement de stock et met à jour le stock de l'ingrédient. delta est signé (+ entrée, − sortie). */
export function recordMovement(ingredientId, delta, { type = 'ajustement', reason = '', ref = '', lot = '', date = today() } = {}) {
  const ing = db.get('ingredients', ingredientId);
  if (!ing) throw new Error('Ingrédient introuvable');
  const before = Number(ing.stock) || 0;
  const after = Math.round((before + Number(delta)) * 10000) / 10000;
  db.insert('movements', { ingredientId, date, type, delta: Number(delta), before, after, reason, ref, lot });
  db.update('ingredients', ingredientId, { stock: after });
  return after;
}

export function stockStatus(ing) {
  const s = db.settings();
  const stock = Number(ing.stock) || 0;
  const min = Number(ing.minStock) || 0;
  if (stock <= 0) return { kind: 'red', label: 'Rupture' };
  const d = daysUntil(ing.expiry);
  if (ing.expiry && d < 0) return { kind: 'red', label: 'Périmé' };
  if (min > 0 && stock < min) return { kind: 'amber', label: 'Stock bas' };
  if (ing.expiry && d <= (s.lowStockDays || 60)) return { kind: 'amber', label: `Expire dans ${d} j` };
  return { kind: 'green', label: 'OK' };
}

export function supplierName(id) { return db.get('suppliers', id)?.name || '—'; }
export function inventoryValue() { return db.all('ingredients').reduce((t, i) => t + (Number(i.stock) || 0) * (Number(i.cost) || 0), 0); }

function nextCode() {
  const codes = db.all('ingredients').map(i => /^ING-(\d+)$/.exec(i.code || '')).filter(Boolean).map(m => +m[1]);
  return 'ING-' + String((codes.length ? Math.max(...codes) : 0) + 1).padStart(3, '0');
}

export function openIngredientForm(existing, onDone) {
  const s = db.settings();
  const ing = existing || { code: nextCode(), unit: 'g', stock: 0, minStock: 0, cost: 0, category: s.categories[0] };
  const suppliers = [['', '— Aucun —'], ...db.all('suppliers').sort((a, b) => a.name.localeCompare(b.name)).map(x => [x.id, x.name])];
  openModal({
    title: existing ? 'Modifier l’ingrédient' : 'Nouvel ingrédient', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'Code', name: 'code', value: ing.code, required: true, cols: 1 })}
      ${field({ label: 'Nom commercial', name: 'name', value: ing.name, required: true, cols: 3 })}
      ${field({ label: 'Nom INCI', name: 'inci', value: ing.inci, cols: 2, placeholder: 'ex. Cetearyl Alcohol' })}
      ${field({ label: 'N° CAS', name: 'cas', value: ing.cas, cols: 1 })}
      ${field({ label: 'Catégorie', name: 'category', type: 'select', options: s.categories, value: ing.category, cols: 1 })}
      ${field({ label: 'Fournisseur', name: 'supplierId', type: 'select', options: suppliers, value: ing.supplierId, cols: 2 })}
      ${field({ label: 'Réf. fournisseur', name: 'supplierRef', value: ing.supplierRef, cols: 1 })}
      ${field({ label: 'Fonction / usage', name: 'role', value: ing.role, cols: 1, placeholder: 'ex. Conditionneur' })}
      <div class="form-section">Stock</div>
      ${field({ label: 'Unité de stock', name: 'unit', type: 'select', options: s.units, value: ing.unit, cols: 1 })}
      ${field({ label: 'Quantité en stock', name: 'stock', type: 'number', step: '0.001', value: ing.stock, cols: 1, help: existing ? 'Modifier ici crée un ajustement.' : '' })}
      ${field({ label: 'Stock minimum (alerte)', name: 'minStock', type: 'number', step: '0.001', value: ing.minStock, cols: 1 })}
      ${field({ label: 'Coût par unité (CAD)', name: 'cost', type: 'number', step: '0.0001', value: ing.cost, cols: 1 })}
      ${field({ label: 'N° de lot', name: 'lot', value: ing.lot, cols: 1 })}
      ${field({ label: 'Date de péremption', name: 'expiry', type: 'date', value: ing.expiry, cols: 1 })}
      ${field({ label: 'Emplacement', name: 'location', value: ing.location, cols: 2, placeholder: 'ex. Armoire A, tablette 2' })}
      ${field({ label: 'Notes (conditions de stockage, sécurité…)', name: 'notes', type: 'textarea', value: ing.notes, cols: 4 })}
    </div>`,
    onSubmit(data) {
      data.stock = Number(data.stock) || 0; data.minStock = Number(data.minStock) || 0; data.cost = Number(data.cost) || 0;
      if (existing) {
        const before = Number(existing.stock) || 0;
        const newStock = data.stock;
        delete data.stock;
        db.update('ingredients', existing.id, data);
        if (Math.abs(newStock - before) > 1e-9) recordMovement(existing.id, newStock - before, { type: 'ajustement', reason: 'Correction manuelle (fiche)' });
        toast('Ingrédient mis à jour');
      } else {
        const rec = db.insert('ingredients', data);
        if (data.stock > 0) recordMovement(rec.id, data.stock, { type: 'entree', reason: 'Stock initial', lot: data.lot });
        toast('Ingrédient créé');
      }
      onDone && onDone();
    }
  });
}

export function openMovementForm(ing, onDone) {
  openModal({
    title: `Mouvement de stock — ${ing.name}`,
    body: `<div class="form-grid">
      <div class="field cols-4"><div class="info">Stock actuel : <b>${num(ing.stock, 3)} ${esc(ing.unit)}</b></div></div>
      ${field({ label: 'Type', name: 'type', type: 'select', options: [['entree', 'Entrée (réception, don, retour)'], ['sortie', 'Sortie (consommation, perte, échantillon)'], ['ajustement', 'Ajustement d’inventaire (fixer la quantité)']], cols: 2 })}
      ${field({ label: 'Quantité (' + ing.unit + ')', name: 'qty', type: 'number', step: '0.001', min: 0, required: true, cols: 1 })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: today(), cols: 1 })}
      ${field({ label: 'N° de lot', name: 'lot', value: ing.lot, cols: 1 })}
      ${field({ label: 'Motif / référence', name: 'reason', cols: 3, placeholder: 'ex. Échantillons envoyés au salon X' })}
    </div>`,
    submitLabel: 'Enregistrer le mouvement',
    onSubmit(d) {
      const qty = Number(d.qty) || 0;
      let delta = qty;
      if (d.type === 'sortie') delta = -qty;
      if (d.type === 'ajustement') delta = qty - (Number(ing.stock) || 0);
      recordMovement(ing.id, delta, { type: d.type, reason: d.reason, lot: d.lot, date: d.date });
      if (d.lot && d.lot !== ing.lot) db.update('ingredients', ing.id, { lot: d.lot });
      toast('Mouvement enregistré'); onDone && onDone();
    }
  });
}

function renderList(el, ctx) {
  const s = db.settings();
  const q = ctx.params.q || '';
  const cat = ctx.params.cat || '';
  const only = ctx.params.only || '';
  let rows = db.all('ingredients').slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  rows = rows.filter(r => matches(r, q, ['code', 'name', 'inci', 'cas', 'lot', 'location', 'role']));
  if (cat) rows = rows.filter(r => r.category === cat);
  if (only === 'alert') rows = rows.filter(r => stockStatus(r).kind !== 'green');
  const all = db.all('ingredients');
  const alerts = all.filter(r => stockStatus(r).kind !== 'green').length;

  el.innerHTML = `
    <div class="stats">
      ${statCard('Ingrédients référencés', all.length)}
      ${statCard('Valeur du stock', money(inventoryValue()), 'au coût unitaire saisi')}
      ${statCard('Alertes (bas / rupture / péremption)', alerts, '', alerts ? 'warn' : 'good')}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Inventaire</h2><div class="subtitle">${rows.length} ingrédient(s) affiché(s)</div></div>
        <div class="actions">
          <button class="btn" data-export>Exporter CSV</button>
          <button class="btn primary" data-new>+ Nouvel ingrédient</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (nom, INCI, code, lot…)" value="${esc(q)}">
        <select data-cat><option value="">Toutes les catégories</option>${s.categories.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select data-only><option value="">Tous</option><option value="alert" ${only === 'alert' ? 'selected' : ''}>Alertes seulement</option></select>
      </div>
      ${table({
        columns: [
          { label: 'Code', render: r => `<span class="muted">${esc(r.code)}</span>` },
          { label: 'Ingrédient', render: r => `<div class="strong">${esc(r.name)}</div><div class="muted">${esc(r.inci || '')}</div>` },
          { label: 'Catégorie', key: 'category' },
          { label: 'Fournisseur', render: r => esc(supplierName(r.supplierId)) },
          { label: 'Stock', align: 'num', render: r => `<b>${num(r.stock, 3)}</b> ${esc(r.unit)}${r.minStock ? `<div class="muted">min ${num(r.minStock, 3)}</div>` : ''}` },
          { label: 'Coût / unité', align: 'num', render: r => money(r.cost) },
          { label: 'Valeur', align: 'num', render: r => money((Number(r.stock) || 0) * (Number(r.cost) || 0)) },
          { label: 'Péremption', render: r => dateFmt(r.expiry) },
          { label: 'Statut', render: r => { const st = stockStatus(r); return badge(st.label, st.kind); } },
          { label: '', render: r => `<div class="row-actions"><button class="btn" data-move="${r.id}">± Stock</button><button class="btn" data-edit="${r.id}">Modifier</button></div>` },
        ],
        rows, empty: all.length ? 'Aucun ingrédient ne correspond aux filtres.' : 'Aucun ingrédient. Cliquez sur « Nouvel ingrédient » pour commencer.',
        rowAttrs: r => `class="clickable" data-open="${r.id}"`
      })}
    </div>`;

  const go = (patch) => ctx.navigate('ingredients', '', { q, cat, only, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-cat]').addEventListener('change', e => go({ cat: e.target.value }));
  el.querySelector('[data-only]').addEventListener('change', e => go({ only: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openIngredientForm(null));
  el.querySelector('[data-export]').addEventListener('click', () => download('inventaire-dermagen-' + today() + '.csv', toCSV(rows, [
    { label: 'Code', value: 'code' }, { label: 'Nom', value: 'name' }, { label: 'INCI', value: 'inci' }, { label: 'Catégorie', value: 'category' },
    { label: 'Fournisseur', value: r => supplierName(r.supplierId) }, { label: 'Stock', value: 'stock' }, { label: 'Unité', value: 'unit' },
    { label: 'Stock min', value: 'minStock' }, { label: 'Coût unitaire', value: 'cost' }, { label: 'Lot', value: 'lot' }, { label: 'Péremption', value: 'expiry' }, { label: 'Emplacement', value: 'location' }
  ]), 'text/csv'));
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b?.dataset.edit) { e.stopPropagation(); return openIngredientForm(db.get('ingredients', b.dataset.edit)); }
    if (b?.dataset.move) { e.stopPropagation(); return openMovementForm(db.get('ingredients', b.dataset.move)); }
    const tr = e.target.closest('tr[data-open]');
    if (tr) ctx.navigate('ingredients', tr.dataset.open);
  });
}

function renderDetail(el, ctx, ing) {
  const st = stockStatus(ing);
  const moves = db.all('movements').filter(m => m.ingredientId === ing.id).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const forms = db.all('formulations').filter(f => (f.lines || []).some(l => l.ingredientId === ing.id));
  const pos = db.all('purchases').filter(p => (p.lines || []).some(l => l.ingredientId === ing.id));
  el.innerHTML = `
    <a href="#/ingredients" class="back">← Retour à l’inventaire</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(ing.name)} ${badge(st.label, st.kind)}</h2><div class="subtitle">${esc(ing.code)} · ${esc(ing.inci || 'INCI non renseigné')}</div></div>
        <div class="actions">
          <button class="btn" data-move>± Mouvement de stock</button>
          <button class="btn" data-edit>Modifier</button>
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      <dl class="detail-grid">
        <div><dt>Stock</dt><dd>${num(ing.stock, 3)} ${esc(ing.unit)}</dd></div>
        <div><dt>Stock minimum</dt><dd>${num(ing.minStock, 3)} ${esc(ing.unit)}</dd></div>
        <div><dt>Coût / unité</dt><dd>${money(ing.cost)} <span class="muted">(${money(costPerGram(ing) * 100)} / 100 g)</span></dd></div>
        <div><dt>Valeur en stock</dt><dd>${money((Number(ing.stock) || 0) * (Number(ing.cost) || 0))}</dd></div>
        <div><dt>Catégorie</dt><dd>${esc(ing.category || '—')}</dd></div>
        <div><dt>Fonction</dt><dd>${esc(ing.role || '—')}</dd></div>
        <div><dt>Fournisseur</dt><dd>${ing.supplierId ? `<a href="#/suppliers/${ing.supplierId}">${esc(supplierName(ing.supplierId))}</a>` : '—'} ${ing.supplierRef ? `<span class="muted">réf. ${esc(ing.supplierRef)}</span>` : ''}</dd></div>
        <div><dt>N° CAS</dt><dd>${esc(ing.cas || '—')}</dd></div>
        <div><dt>Lot</dt><dd>${esc(ing.lot || '—')}</dd></div>
        <div><dt>Péremption</dt><dd>${dateFmt(ing.expiry)}</dd></div>
        <div><dt>Emplacement</dt><dd>${esc(ing.location || '—')}</dd></div>
      </dl>
      ${ing.notes ? `<p style="margin-top:14px;white-space:pre-wrap">${esc(ing.notes)}</p>` : ''}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h3>Historique des mouvements</h3></div>
        ${table({
          columns: [
            { label: 'Date', render: m => dateFmt(m.date) },
            { label: 'Type', render: m => badge(MOVEMENT_TYPES[m.type] || m.type, m.delta >= 0 ? 'green' : 'amber') },
            { label: 'Quantité', align: 'num', render: m => `<b>${m.delta >= 0 ? '+' : ''}${num(m.delta, 3)}</b>` },
            { label: 'Après', align: 'num', render: m => num(m.after, 3) },
            { label: 'Motif', render: m => `${esc(m.reason || '')}${m.ref ? ` <span class="muted">${esc(m.ref)}</span>` : ''}${m.lot ? `<div class="muted">lot ${esc(m.lot)}</div>` : ''}` },
          ], rows: moves, empty: 'Aucun mouvement.'
        })}
      </div>
      <div class="card">
        <div class="card-head"><h3>Utilisé dans ${forms.length} formulation(s)</h3></div>
        ${table({
          columns: [
            { label: 'Code', render: f => `<a href="#/formulations/${f.id}">${esc(f.code)}</a>` },
            { label: 'Nom', key: 'name' },
            { label: '%', align: 'num', render: f => num((f.lines || []).filter(l => l.ingredientId === ing.id).reduce((t, l) => t + (Number(l.pct) || 0), 0), 2) + ' %' },
            { label: 'Statut', key: 'status' },
          ], rows: forms, empty: 'Pas encore utilisé dans une formulation.'
        })}
        <div class="card-head" style="margin-top:18px"><h3>Commandes (${pos.length})</h3></div>
        ${table({
          columns: [
            { label: 'N°', render: p => `<a href="#/purchases/${p.id}">${esc(p.number)}</a>` },
            { label: 'Date', render: p => dateFmt(p.date) },
            { label: 'Statut', key: 'status' },
            { label: 'Qté', align: 'num', render: p => num((p.lines || []).filter(l => l.ingredientId === ing.id).reduce((t, l) => t + (Number(l.qty) || 0), 0), 3) },
          ], rows: pos, empty: 'Aucune commande.'
        })}
      </div>
    </div>`;
  el.querySelector('[data-edit]').addEventListener('click', () => openIngredientForm(ing));
  el.querySelector('[data-move]').addEventListener('click', () => openMovementForm(ing));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer « ${ing.name} » et son historique de mouvements ?`, { label: 'Supprimer' })) {
      db.all('movements').filter(m => m.ingredientId === ing.id).forEach(m => db.remove('movements', m.id));
      db.remove('ingredients', ing.id); toast('Ingrédient supprimé'); ctx.navigate('ingredients');
    }
  });
}

export default {
  title: 'Inventaire des ingrédients',
  render(el, ctx) {
    if (ctx.id) { const ing = db.get('ingredients', ctx.id); if (ing) return renderDetail(el, ctx, ing); }
    renderList(el, ctx);
  }
};
