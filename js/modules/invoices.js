// Factures fournisseurs : suivi des montants, échéances et paiements.
import { db } from '../store.js';
import { esc, money, dateFmt, today, addDays, daysUntil, toast, badge, openModal, confirmDialog, field, table, matches, statCard, num } from '../ui.js';
import { computeTaxes } from './purchases.js';
import { openPaymentForm } from './payments.js';

export function invoicePaid(inv) {
  return db.all('payments').filter(p => p.invoiceId === inv.id).reduce((t, p) => t + (Number(p.amount) || 0), 0);
}
export function invoiceStatus(inv) {
  const total = Number(inv.total) || 0, paid = invoicePaid(inv);
  if (inv.cancelled) return { label: 'Annulée', kind: 'grey', key: 'cancelled' };
  if (paid >= total - 0.005) return { label: 'Payée', kind: 'green', key: 'paid' };
  const late = inv.dueDate && daysUntil(inv.dueDate) < 0;
  if (paid > 0) return { label: late ? 'Partielle · en retard' : 'Partiellement payée', kind: late ? 'red' : 'amber', key: late ? 'late' : 'partial' };
  if (late) return { label: `En retard (${-daysUntil(inv.dueDate)} j)`, kind: 'red', key: 'late' };
  return { label: 'À payer', kind: 'blue', key: 'open' };
}
export const invoiceBalance = (inv) => Math.max(0, (Number(inv.total) || 0) - invoicePaid(inv));

function termsDays(terms) { const m = /Net\s*(\d+)/i.exec(terms || ''); return m ? +m[1] : 0; }

export function openInvoiceForm(existing, onDone, { fromPurchase } = {}) {
  const suppliers = db.all('suppliers').slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!suppliers.length) return toast('Créez d’abord un fournisseur.', 'warn');
  const purchases = db.all('purchases').slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let inv = existing;
  if (!inv) {
    const sup = fromPurchase ? db.get('suppliers', fromPurchase.supplierId) : suppliers[0];
    const date = today();
    inv = {
      number: db.nextNumber('invoices', 'number', 'FA'), supplierId: sup?.id || suppliers[0].id, purchaseId: fromPurchase?.id || '',
      date, dueDate: addDays(date, termsDays(sup?.paymentTerms) || 30),
      subtotal: fromPurchase?.subtotal || 0, shipping: fromPurchase?.shipping || 0, applyTaxes: fromPurchase ? fromPurchase.applyTaxes !== false : true,
      description: fromPurchase ? `Commande ${fromPurchase.number}` : ''
    };
  }
  const m = openModal({
    title: existing ? `Modifier ${inv.number}` : 'Nouvelle facture fournisseur', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'N° interne', name: 'number', value: inv.number, required: true, cols: 1 })}
      ${field({ label: 'N° de facture du fournisseur', name: 'supplierInvoiceNumber', value: inv.supplierInvoiceNumber, cols: 1 })}
      ${field({ label: 'Fournisseur', name: 'supplierId', type: 'select', options: suppliers.map(s => [s.id, s.name]), value: inv.supplierId, required: true, cols: 2 })}
      ${field({ label: 'Date de facture', name: 'date', type: 'date', value: inv.date, required: true, cols: 1 })}
      ${field({ label: 'Échéance', name: 'dueDate', type: 'date', value: inv.dueDate, required: true, cols: 1 })}
      ${field({ label: 'Bon de commande lié', name: 'purchaseId', type: 'select', options: [['', '— Aucun —'], ...purchases.map(p => [p.id, `${p.number} · ${money(p.total)}`])], value: inv.purchaseId, cols: 2 })}
      ${field({ label: 'Description', name: 'description', value: inv.description, cols: 4, placeholder: 'ex. Commande d’actifs de septembre' })}
      <div class="form-section">Montants</div>
      ${field({ label: 'Sous-total (avant taxes)', name: 'subtotal', type: 'number', step: '0.01', min: 0, value: inv.subtotal, required: true, cols: 1 })}
      ${field({ label: 'Livraison', name: 'shipping', type: 'number', step: '0.01', min: 0, value: inv.shipping, cols: 1 })}
      ${field({ label: 'Appliquer TPS + TVQ', name: 'applyTaxes', type: 'checkbox', value: inv.applyTaxes !== false, cols: 2 })}
      <div class="field cols-2"></div>
      <div class="field cols-2"><div class="totals"><div><span>TPS</span><span data-tps>0</span></div><div><span>TVQ</span><span data-tvq>0</span></div><div><span>Total</span><span data-total>0</span></div></div></div>
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2, value: inv.notes, cols: 4 })}
    </div>`,
    submitLabel: existing ? 'Enregistrer' : 'Créer la facture',
    onSubmit(data) {
      Object.assign(data, computeTaxes(data.subtotal, data.shipping, data.applyTaxes));
      if (existing) { db.update('invoices', existing.id, data); toast('Facture mise à jour'); onDone && onDone(existing.id); }
      else { const r = db.insert('invoices', data); if (data.purchaseId) db.update('purchases', data.purchaseId, { invoiceId: r.id }); toast('Facture créée'); onDone && onDone(r.id); }
    }
  });
  const form = m.form;
  const recalc = () => {
    const t = computeTaxes(form.querySelector('[name=subtotal]').value, form.querySelector('[name=shipping]').value, form.querySelector('[name=applyTaxes]').checked);
    form.querySelector('[data-tps]').textContent = money(t.tps); form.querySelector('[data-tvq]').textContent = money(t.tvq); form.querySelector('[data-total]').textContent = money(t.total);
  };
  form.addEventListener('input', recalc);
  form.addEventListener('change', e => {
    if (e.target.name === 'supplierId' && !existing) { const sup = db.get('suppliers', e.target.value); form.querySelector('[name=dueDate]').value = addDays(form.querySelector('[name=date]').value || today(), termsDays(sup?.paymentTerms) || 30); }
    if (e.target.name === 'purchaseId' && e.target.value) { const po = db.get('purchases', e.target.value); if (po) { form.querySelector('[name=subtotal]').value = po.subtotal; form.querySelector('[name=shipping]').value = po.shipping || 0; form.querySelector('[name=applyTaxes]').checked = po.applyTaxes !== false; form.querySelector('[name=supplierId]').value = po.supplierId; } }
    recalc();
  });
  recalc();
}

function renderList(el, ctx) {
  const q = ctx.params.q || '', st = ctx.params.status || '';
  const all = db.all('invoices');
  const supName = (id) => db.get('suppliers', id)?.name || '—';
  let rows = all.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  rows = rows.filter(r => matches({ ...r, sup: supName(r.supplierId) }, q, ['number', 'supplierInvoiceNumber', 'sup', 'description']));
  if (st) rows = rows.filter(r => invoiceStatus(r).key === st);
  const active = all.filter(i => !i.cancelled);
  const due = active.reduce((t, i) => t + invoiceBalance(i), 0);
  const late = active.filter(i => invoiceStatus(i).key === 'late');
  const next30 = active.filter(i => invoiceBalance(i) > 0 && daysUntil(i.dueDate) >= 0 && daysUntil(i.dueDate) <= 30).reduce((t, i) => t + invoiceBalance(i), 0);
  el.innerHTML = `
    <div class="stats">
      ${statCard('Solde à payer', money(due), active.filter(i => invoiceBalance(i) > 0).length + ' facture(s) ouverte(s)', due > 0 ? 'warn' : 'good')}
      ${statCard('En retard', money(late.reduce((t, i) => t + invoiceBalance(i), 0)), late.length + ' facture(s)', late.length ? 'danger' : 'good')}
      ${statCard('Échéances sous 30 jours', money(next30))}
      ${statCard('Facturé cette année', money(active.filter(i => (i.date || '').startsWith(String(new Date().getFullYear()))).reduce((t, i) => t + (Number(i.total) || 0), 0)))}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Factures fournisseurs</h2><div class="subtitle">Comptes à payer</div></div>
        <div class="actions"><button class="btn primary" data-new>+ Nouvelle facture</button></div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (n°, fournisseur…)" value="${esc(q)}">
        <select data-status><option value="">Tous les statuts</option>${[['open', 'À payer'], ['partial', 'Partiellement payée'], ['late', 'En retard'], ['paid', 'Payée'], ['cancelled', 'Annulée']].map(([k, l]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${table({
        columns: [
          { label: 'N°', render: r => `<span class="strong">${esc(r.number)}</span>${r.supplierInvoiceNumber ? `<div class="muted">${esc(r.supplierInvoiceNumber)}</div>` : ''}` },
          { label: 'Fournisseur', render: r => `${esc(supName(r.supplierId))}${r.description ? `<div class="muted">${esc(r.description)}</div>` : ''}` },
          { label: 'Date', render: r => dateFmt(r.date) },
          { label: 'Échéance', render: r => dateFmt(r.dueDate) },
          { label: 'Total', align: 'num', render: r => money(r.total) },
          { label: 'Payé', align: 'num', render: r => money(invoicePaid(r)) },
          { label: 'Solde', align: 'num', render: r => `<b>${money(invoiceBalance(r))}</b>` },
          { label: 'Statut', render: r => { const s = invoiceStatus(r); return badge(s.label, s.kind); } },
          { label: '', render: r => invoiceBalance(r) > 0 && !r.cancelled ? `<div class="row-actions"><button class="btn" data-pay="${r.id}">Payer</button></div>` : '' },
        ], rows, empty: all.length ? 'Aucune facture ne correspond.' : 'Aucune facture enregistrée.',
        rowAttrs: r => `class="clickable" data-open="${r.id}"`
      })}
    </div>`;
  const go = (patch) => ctx.navigate('invoices', '', { q, status: st, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-status]').addEventListener('change', e => go({ status: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openInvoiceForm(null, id => ctx.navigate('invoices', id)));
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-pay]');
    if (b) { e.stopPropagation(); return openPaymentForm(db.get('invoices', b.dataset.pay)); }
    const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('invoices', tr.dataset.open);
  });
}

function renderDetail(el, ctx, inv) {
  const sup = db.get('suppliers', inv.supplierId);
  const po = inv.purchaseId && db.get('purchases', inv.purchaseId);
  const st = invoiceStatus(inv);
  const pays = db.all('payments').filter(p => p.invoiceId === inv.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const s = db.settings();
  el.innerHTML = `
    <a href="#/invoices" class="back">← Retour aux factures</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(inv.number)} ${badge(st.label, st.kind)}</h2>
          <div class="subtitle">${sup ? `<a href="#/suppliers/${sup.id}">${esc(sup.name)}</a>` : 'Fournisseur inconnu'}${inv.supplierInvoiceNumber ? ' · n° fournisseur ' + esc(inv.supplierInvoiceNumber) : ''} · émise le ${dateFmt(inv.date)} · échéance ${dateFmt(inv.dueDate)}</div></div>
        <div class="actions">
          ${invoiceBalance(inv) > 0 && !inv.cancelled ? '<button class="btn primary" data-pay>Enregistrer un paiement</button>' : ''}
          <button class="btn" data-edit>Modifier</button>
          ${inv.cancelled ? '<button class="btn" data-uncancel>Réactiver</button>' : '<button class="btn" data-cancel>Annuler la facture</button>'}
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      ${inv.description ? `<p>${esc(inv.description)}</p>` : ''}
      ${po ? `<div class="info">Bon de commande lié : <a href="#/purchases/${po.id}">${esc(po.number)}</a> (${esc(po.status)})</div>` : ''}
      <div class="grid two">
        <div class="totals" style="margin-left:0">
          <div><span>Sous-total</span><span>${money(inv.subtotal)}</span></div>
          ${inv.shipping ? `<div><span>Livraison</span><span>${money(inv.shipping)}</span></div>` : ''}
          <div><span>TPS (${s.tps} %)</span><span>${money(inv.tps)}</span></div>
          <div><span>TVQ (${s.tvq} %)</span><span>${money(inv.tvq)}</span></div>
          <div><span>Total</span><span>${money(inv.total)}</span></div>
        </div>
        <div class="totals" style="margin-left:0">
          <div><span>Payé</span><span>${money(invoicePaid(inv))}</span></div>
          <div><span>Solde restant</span><span class="${invoiceBalance(inv) > 0 ? 'pct-bad' : 'pct-ok'}">${money(invoiceBalance(inv))}</span></div>
        </div>
      </div>
      ${inv.notes ? `<p style="margin-top:14px;white-space:pre-wrap">${esc(inv.notes)}</p>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h3>Paiements (${pays.length})</h3></div>
      ${table({
        columns: [
          { label: 'Date', render: p => dateFmt(p.date) },
          { label: 'Méthode', key: 'method' },
          { label: 'Référence', key: 'reference' },
          { label: 'Notes', key: 'notes' },
          { label: 'Montant', align: 'num', render: p => `<b>${money(p.amount)}</b>` },
          { label: '', render: p => `<div class="row-actions"><button class="btn" data-delpay="${p.id}">Supprimer</button></div>` },
        ], rows: pays, empty: 'Aucun paiement enregistré.'
      })}
    </div>`;
  el.querySelector('[data-pay]')?.addEventListener('click', () => openPaymentForm(inv));
  el.querySelector('[data-edit]').addEventListener('click', () => openInvoiceForm(inv));
  el.querySelector('[data-cancel]')?.addEventListener('click', async () => { if (await confirmDialog('Annuler cette facture ? Elle ne comptera plus dans les soldes.', { label: 'Annuler la facture' })) { db.update('invoices', inv.id, { cancelled: true }); toast('Facture annulée'); } });
  el.querySelector('[data-uncancel]')?.addEventListener('click', () => { db.update('invoices', inv.id, { cancelled: false }); toast('Facture réactivée'); });
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer la facture ${inv.number} et ses ${pays.length} paiement(s) ?`, { label: 'Supprimer' })) {
      pays.forEach(p => db.remove('payments', p.id)); db.remove('invoices', inv.id); toast('Facture supprimée'); ctx.navigate('invoices');
    }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-delpay]');
    if (b && await confirmDialog('Supprimer ce paiement ?', { label: 'Supprimer' })) { db.remove('payments', b.dataset.delpay); toast('Paiement supprimé'); }
  });
}

export default {
  title: 'Factures',
  render(el, ctx) {
    if (ctx.id) { const i = db.get('invoices', ctx.id); if (i) return renderDetail(el, ctx, i); }
    renderList(el, ctx);
  }
};
