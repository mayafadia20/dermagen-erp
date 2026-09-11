// Bons de commande : lignes d'achat, taxes, réception en inventaire, création de facture.
import { db } from '../store.js';
import { esc, money, num, dateFmt, today, addDays, toast, badge, openModal, confirmDialog, field, table, matches, statCard } from '../ui.js';
import { recordMovement } from './ingredients.js';
import { openInvoiceForm } from './invoices.js';

export const PO_STATUSES = ['Brouillon', 'Envoyée', 'Reçue', 'Annulée'];
const KIND = { 'Brouillon': 'grey', 'Envoyée': 'blue', 'Reçue': 'green', 'Annulée': 'red' };

export function computeTaxes(subtotal, shipping, applyTaxes) {
  const s = db.settings();
  const base = (Number(subtotal) || 0) + (Number(shipping) || 0);
  const tps = applyTaxes ? base * (Number(s.tps) || 0) / 100 : 0;
  const tvq = applyTaxes ? base * (Number(s.tvq) || 0) / 100 : 0;
  const r = (x) => Math.round(x * 100) / 100;
  return { subtotal: r(subtotal), shipping: r(shipping), tps: r(tps), tvq: r(tvq), total: r(base + tps + tvq) };
}

function lineRow(l = {}, ingredients) {
  const opts = ['<option value="">— Autre / saisie libre —</option>', ...ingredients.map(i => `<option value="${i.id}" data-unit="${esc(i.unit)}" data-cost="${i.cost || ''}" data-name="${esc(i.name)}" ${i.id === l.ingredientId ? 'selected' : ''}>${esc(i.name)}</option>`)].join('');
  return `<tr data-repeat-row>
    <td style="min-width:180px"><select name="ingredientId">${opts}</select></td>
    <td><input name="description" value="${esc(l.description || '')}" placeholder="Description / réf."></td>
    <td style="width:100px"><input name="qty" type="number" step="0.001" min="0" value="${l.qty ?? ''}" placeholder="Qté"></td>
    <td style="width:80px"><input name="unit" value="${esc(l.unit || '')}" placeholder="Unité"></td>
    <td style="width:120px"><input name="unitPrice" type="number" step="0.0001" min="0" value="${l.unitPrice ?? ''}" placeholder="Prix unit."></td>
    <td class="num" style="width:110px" data-line-total>—</td>
    <td style="width:40px"><button type="button" class="icon-btn del" data-del-line title="Retirer">✕</button></td>
  </tr>`;
}

function readLines(form) {
  return [...form.querySelectorAll('[data-repeat-row]')].map(tr => {
    const sel = tr.querySelector('[name=ingredientId]');
    return {
      ingredientId: sel.value,
      description: tr.querySelector('[name=description]').value.trim() || sel.selectedOptions[0]?.dataset.name || '',
      qty: Number(tr.querySelector('[name=qty]').value) || 0,
      unit: tr.querySelector('[name=unit]').value.trim(),
      unitPrice: Number(tr.querySelector('[name=unitPrice]').value) || 0
    };
  }).filter(l => l.qty > 0 || l.description);
}

export function openPurchaseForm(existing, onDone, { supplierId } = {}) {
  const ingredients = db.all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name));
  const suppliers = db.all('suppliers').slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!suppliers.length) return toast('Créez d’abord un fournisseur.', 'warn');
  const po = existing || { number: db.nextNumber('purchases', 'number', 'BC'), date: today(), expectedDate: addDays(today(), 14), status: 'Brouillon', supplierId: supplierId || suppliers[0].id, applyTaxes: true, shipping: 0, lines: [{}, {}] };
  const m = openModal({
    title: existing ? `Modifier ${po.number}` : 'Nouveau bon de commande', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'N° de commande', name: 'number', value: po.number, required: true, cols: 1 })}
      ${field({ label: 'Fournisseur', name: 'supplierId', type: 'select', options: suppliers.map(s => [s.id, s.name]), value: po.supplierId, required: true, cols: 2 })}
      ${field({ label: 'Statut', name: 'status', type: 'select', options: PO_STATUSES.filter(s => s !== 'Reçue' || po.status === 'Reçue'), value: po.status, cols: 1 })}
      ${field({ label: 'Date de commande', name: 'date', type: 'date', value: po.date, required: true, cols: 1 })}
      ${field({ label: 'Livraison prévue', name: 'expectedDate', type: 'date', value: po.expectedDate, cols: 1 })}
      ${field({ label: 'Référence fournisseur / devis', name: 'supplierRef', value: po.supplierRef, cols: 2 })}
      <div class="form-section">Articles</div>
      <div class="lines">
        <table><thead><tr><th>Ingrédient</th><th>Description</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th class="num">Total</th><th></th></tr></thead>
        <tbody data-lines>${(po.lines || []).map(l => lineRow(l, ingredients)).join('')}</tbody></table>
        <div class="lines-foot"><button type="button" class="btn sm" data-add-line>+ Ajouter un article</button><span>Sous-total : <b data-subtotal>0</b></span></div>
      </div>
      ${field({ label: 'Frais de livraison', name: 'shipping', type: 'number', step: '0.01', min: 0, value: po.shipping, cols: 1 })}
      ${field({ label: 'Appliquer TPS + TVQ', name: 'applyTaxes', type: 'checkbox', value: po.applyTaxes !== false, cols: 1 })}
      <div class="field cols-2"><div class="totals"><div><span>TPS</span><span data-tps>0</span></div><div><span>TVQ</span><span data-tvq>0</span></div><div><span>Total</span><span data-total>0</span></div></div></div>
      ${field({ label: 'Notes / instructions', name: 'notes', type: 'textarea', rows: 2, value: po.notes, cols: 4 })}
    </div>`,
    submitLabel: existing ? 'Enregistrer' : 'Créer la commande',
    onSubmit(data, { form }) {
      const lines = readLines(form);
      if (!lines.length) { toast('Ajoutez au moins un article.', 'warn'); return false; }
      const subtotal = lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
      Object.assign(data, computeTaxes(subtotal, data.shipping, data.applyTaxes), { lines });
      if (existing) { db.update('purchases', existing.id, data); toast('Commande mise à jour'); onDone && onDone(existing.id); }
      else { const r = db.insert('purchases', data); toast('Commande créée'); onDone && onDone(r.id); }
    }
  });
  const form = m.form, tbody = form.querySelector('[data-lines]');
  const recalc = () => {
    let sub = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      const t = (Number(tr.querySelector('[name=qty]').value) || 0) * (Number(tr.querySelector('[name=unitPrice]').value) || 0);
      tr.querySelector('[data-line-total]').textContent = money(t); sub += t;
    });
    const tx = computeTaxes(sub, form.querySelector('[name=shipping]').value, form.querySelector('[name=applyTaxes]').checked);
    form.querySelector('[data-subtotal]').textContent = money(tx.subtotal);
    form.querySelector('[data-tps]').textContent = money(tx.tps);
    form.querySelector('[data-tvq]').textContent = money(tx.tvq);
    form.querySelector('[data-total]').textContent = money(tx.total);
  };
  form.addEventListener('input', recalc);
  form.addEventListener('change', e => {
    if (e.target.name === 'ingredientId') {
      const o = e.target.selectedOptions[0], tr = e.target.closest('tr');
      if (o?.value) { tr.querySelector('[name=unit]').value = o.dataset.unit || ''; if (!tr.querySelector('[name=unitPrice]').value) tr.querySelector('[name=unitPrice]').value = o.dataset.cost || ''; }
    }
    recalc();
  });
  form.querySelector('[data-add-line]').addEventListener('click', () => { tbody.insertAdjacentHTML('beforeend', lineRow({}, ingredients)); recalc(); });
  form.addEventListener('click', e => { const b = e.target.closest('[data-del-line]'); if (b) { b.closest('tr').remove(); recalc(); } });
  recalc();
}

function openReceiveForm(po, ctx) {
  const lines = (po.lines || []).filter(l => l.ingredientId);
  openModal({
    title: `Réceptionner ${po.number}`, wide: true,
    body: `<div class="form-grid">
      <div class="field cols-4"><div class="info">Les quantités reçues seront ajoutées à l’inventaire. Le coût unitaire des ingrédients sera mis à jour avec le prix d’achat si la case est cochée.</div></div>
      ${field({ label: 'Date de réception', name: 'receivedAt', type: 'date', value: today(), cols: 1 })}
      ${field({ label: 'Mettre à jour le coût unitaire des ingrédients', name: 'updateCost', type: 'checkbox', value: true, cols: 3 })}
      <div class="lines"><table><thead><tr><th>Ingrédient</th><th>Commandé</th><th>Reçu</th><th>Lot</th><th>Péremption</th></tr></thead><tbody>
        ${lines.map((l, i) => { const ing = db.get('ingredients', l.ingredientId); return `<tr data-repeat-row data-idx="${i}">
          <td>${esc(ing?.name || l.description)}</td>
          <td>${num(l.qty, 3)} ${esc(l.unit)}</td>
          <td style="width:120px"><input name="qty" type="number" step="0.001" min="0" value="${l.qty}"></td>
          <td style="width:150px"><input name="lot" placeholder="N° de lot"></td>
          <td style="width:160px"><input name="expiry" type="date"></td></tr>`; }).join('')}
      </tbody></table></div>
      ${lines.length < (po.lines || []).length ? `<div class="field cols-4"><small>${(po.lines || []).length - lines.length} ligne(s) sans ingrédient lié ne seront pas ajoutées à l’inventaire.</small></div>` : ''}
    </div>`,
    submitLabel: 'Confirmer la réception',
    onSubmit(d, { form }) {
      form.querySelectorAll('[data-repeat-row]').forEach(tr => {
        const l = lines[+tr.dataset.idx];
        const qty = Number(tr.querySelector('[name=qty]').value) || 0;
        const lot = tr.querySelector('[name=lot]').value.trim(), expiry = tr.querySelector('[name=expiry]').value;
        const ing = db.get('ingredients', l.ingredientId); if (!ing) return;
        if (qty > 0) recordMovement(ing.id, qty, { type: 'reception', reason: `Réception ${po.number}`, ref: po.number, lot, date: d.receivedAt });
        const patch = {};
        if (d.updateCost && l.unitPrice > 0) patch.cost = l.unitPrice;
        if (lot) patch.lot = lot; if (expiry) patch.expiry = expiry;
        if (Object.keys(patch).length) db.update('ingredients', ing.id, patch);
      });
      db.update('purchases', po.id, { status: 'Reçue', receivedAt: d.receivedAt });
      toast('Commande réceptionnée, inventaire mis à jour');
    }
  });
}

function renderList(el, ctx) {
  if (ctx.params.new) { setTimeout(() => openPurchaseForm(null, id => ctx.navigate('purchases', id), { supplierId: ctx.params.supplier }), 0); ctx.navigate('purchases'); return; }
  const q = ctx.params.q || '', st = ctx.params.status || '';
  const all = db.all('purchases');
  const supName = (id) => db.get('suppliers', id)?.name || '—';
  let rows = all.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  rows = rows.filter(r => matches({ ...r, sup: supName(r.supplierId) }, q, ['number', 'sup', 'supplierRef', 'notes']));
  if (st) rows = rows.filter(r => r.status === st);
  const open = all.filter(p => p.status === 'Envoyée');
  el.innerHTML = `
    <div class="stats">
      ${statCard('Commandes', all.length)}
      ${statCard('En attente de livraison', open.length, money(open.reduce((t, p) => t + (Number(p.total) || 0), 0)), open.length ? 'warn' : '')}
      ${statCard('Achats cette année', money(all.filter(p => p.status !== 'Annulée' && (p.date || '').startsWith(String(new Date().getFullYear()))).reduce((t, p) => t + (Number(p.total) || 0), 0)))}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Bons de commande</h2><div class="subtitle">Achats d’ingrédients et de matériel</div></div>
        <div class="actions"><button class="btn primary" data-new>+ Nouvelle commande</button></div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (n°, fournisseur…)" value="${esc(q)}">
        <select data-status><option value="">Tous les statuts</option>${PO_STATUSES.map(x => `<option ${x === st ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      ${table({
        columns: [
          { label: 'N°', render: r => `<span class="strong">${esc(r.number)}</span>` },
          { label: 'Fournisseur', render: r => esc(supName(r.supplierId)) },
          { label: 'Date', render: r => dateFmt(r.date) },
          { label: 'Livraison prévue', render: r => dateFmt(r.expectedDate) },
          { label: 'Articles', align: 'num', render: r => (r.lines || []).length },
          { label: 'Total', align: 'num', render: r => `<b>${money(r.total)}</b>` },
          { label: 'Statut', render: r => badge(r.status, KIND[r.status] || 'grey') },
          { label: 'Facture', render: r => { const inv = db.all('invoices').find(i => i.purchaseId === r.id); return inv ? `<a href="#/invoices/${inv.id}">${esc(inv.number)}</a>` : '<span class="muted">—</span>'; } },
        ], rows, empty: all.length ? 'Aucune commande ne correspond.' : 'Aucune commande. Créez un fournisseur puis une commande.',
        rowAttrs: r => `class="clickable" data-open="${r.id}"`
      })}
    </div>`;
  const go = (patch) => ctx.navigate('purchases', '', { q, status: st, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-status]').addEventListener('change', e => go({ status: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openPurchaseForm(null, id => ctx.navigate('purchases', id)));
  el.addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('purchases', tr.dataset.open); });
}

function renderDetail(el, ctx, po) {
  const sup = db.get('suppliers', po.supplierId);
  const inv = db.all('invoices').find(i => i.purchaseId === po.id);
  const s = db.settings();
  el.innerHTML = `
    <a href="#/purchases" class="back">← Retour aux commandes</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(po.number)} ${badge(po.status, KIND[po.status] || 'grey')}</h2>
          <div class="subtitle">${sup ? `<a href="#/suppliers/${sup.id}">${esc(sup.name)}</a>` : 'Fournisseur inconnu'} · commandé le ${dateFmt(po.date)} · livraison prévue ${dateFmt(po.expectedDate)}${po.receivedAt ? ' · reçu le ' + dateFmt(po.receivedAt) : ''}</div></div>
        <div class="actions">
          <button class="btn" data-print>Imprimer</button>
          ${po.status === 'Brouillon' ? '<button class="btn" data-send>Marquer envoyée</button>' : ''}
          ${po.status === 'Envoyée' || po.status === 'Brouillon' ? '<button class="btn primary" data-receive>Réceptionner</button>' : ''}
          ${!inv && po.status !== 'Annulée' ? '<button class="btn" data-invoice>Créer la facture</button>' : ''}
          ${po.status !== 'Reçue' ? '<button class="btn" data-edit>Modifier</button>' : ''}
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      ${inv ? `<div class="info">Facture liée : <a href="#/invoices/${inv.id}">${esc(inv.number)}</a></div>` : ''}
      ${po.supplierRef ? `<p class="muted">Réf. fournisseur : ${esc(po.supplierRef)}</p>` : ''}
      ${table({
        columns: [
          { label: 'Article', render: l => { const i = l.ingredientId && db.get('ingredients', l.ingredientId); return i ? `<a href="#/ingredients/${i.id}">${esc(i.name)}</a>${l.description && l.description !== i.name ? `<div class="muted">${esc(l.description)}</div>` : ''}` : esc(l.description); } },
          { label: 'Quantité', align: 'num', render: l => `${num(l.qty, 3)} ${esc(l.unit || '')}` },
          { label: 'Prix unitaire', align: 'num', render: l => money(l.unitPrice) },
          { label: 'Total', align: 'num', render: l => money(l.qty * l.unitPrice) },
        ], rows: po.lines || []
      })}
      <div class="totals" style="margin-top:14px">
        <div><span>Sous-total</span><span>${money(po.subtotal)}</span></div>
        ${po.shipping ? `<div><span>Livraison</span><span>${money(po.shipping)}</span></div>` : ''}
        <div><span>TPS (${s.tps} %)</span><span>${money(po.tps)}</span></div>
        <div><span>TVQ (${s.tvq} %)</span><span>${money(po.tvq)}</span></div>
        <div><span>Total</span><span>${money(po.total)}</span></div>
      </div>
      ${po.notes ? `<p style="margin-top:14px;white-space:pre-wrap">${esc(po.notes)}</p>` : ''}
    </div>`;
  el.querySelector('[data-print]').addEventListener('click', () => window.print());
  el.querySelector('[data-edit]')?.addEventListener('click', () => openPurchaseForm(po));
  el.querySelector('[data-send]')?.addEventListener('click', () => { db.update('purchases', po.id, { status: 'Envoyée' }); toast('Commande marquée envoyée'); });
  el.querySelector('[data-receive]')?.addEventListener('click', () => openReceiveForm(po, ctx));
  el.querySelector('[data-invoice]')?.addEventListener('click', () => openInvoiceForm(null, id => ctx.navigate('invoices', id), { fromPurchase: po }));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer la commande ${po.number} ? Les mouvements d’inventaire déjà enregistrés ne seront pas annulés.`, { label: 'Supprimer' })) { db.remove('purchases', po.id); toast('Commande supprimée'); ctx.navigate('purchases'); }
  });
}

export default {
  title: 'Bons de commande',
  render(el, ctx) {
    if (ctx.id) { const p = db.get('purchases', ctx.id); if (p) return renderDetail(el, ctx, p); }
    renderList(el, ctx);
  }
};
