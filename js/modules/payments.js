// Paiements : règlement des factures fournisseurs.
import { db } from '../store.js';
import { esc, money, dateFmt, today, toast, badge, openModal, confirmDialog, field, table, matches, statCard, download, toCSV } from '../ui.js';
import { invoiceBalance, invoiceStatus } from './invoices.js';

export function openPaymentForm(invoice, onDone) {
  const s = db.settings();
  const open = db.all('invoices').filter(i => !i.cancelled && invoiceBalance(i) > 0).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  if (!invoice && !open.length) return toast('Aucune facture ouverte à payer.', 'warn');
  const supName = (id) => db.get('suppliers', id)?.name || '—';
  const options = (invoice ? [invoice] : open).map(i => [i.id, `${i.number} · ${supName(i.supplierId)} · solde ${money(invoiceBalance(i))}`]);
  const m = openModal({
    title: invoice ? `Paiement — ${invoice.number}` : 'Enregistrer un paiement',
    body: `<div class="form-grid">
      ${field({ label: 'Facture', name: 'invoiceId', type: 'select', options, value: invoice?.id, required: true, cols: 4, attrs: invoice ? 'disabled' : '' })}
      ${field({ label: 'Montant', name: 'amount', type: 'number', step: '0.01', min: 0.01, value: invoiceBalance(invoice || open[0]).toFixed(2), required: true, cols: 2 })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: today(), required: true, cols: 2 })}
      ${field({ label: 'Méthode', name: 'method', type: 'select', options: s.paymentMethods, cols: 2 })}
      ${field({ label: 'Référence (n° de confirmation, chèque…)', name: 'reference', cols: 2 })}
      ${field({ label: 'Notes', name: 'notes', cols: 4 })}
    </div>`,
    submitLabel: 'Enregistrer le paiement',
    onSubmit(d) {
      const invoiceId = invoice ? invoice.id : d.invoiceId;
      const inv = db.get('invoices', invoiceId); if (!inv) throw new Error('Facture introuvable');
      const amount = Number(d.amount) || 0;
      if (amount <= 0) { toast('Le montant doit être positif.', 'warn'); return false; }
      if (amount > invoiceBalance(inv) + 0.005 && !confirm(`Le montant (${money(amount)}) dépasse le solde (${money(invoiceBalance(inv))}). Continuer ?`)) return false;
      db.insert('payments', { invoiceId, amount, date: d.date, method: d.method, reference: d.reference, notes: d.notes });
      toast('Paiement enregistré'); onDone && onDone();
    }
  });
  if (!invoice) m.form.querySelector('[name=invoiceId]').addEventListener('change', e => {
    const inv = db.get('invoices', e.target.value); if (inv) m.form.querySelector('[name=amount]').value = invoiceBalance(inv).toFixed(2);
  });
}

export default {
  title: 'Paiements',
  render(el, ctx) {
    const q = ctx.params.q || '';
    const all = db.all('payments');
    const invOf = (p) => db.get('invoices', p.invoiceId);
    const supName = (p) => { const i = invOf(p); return i ? (db.get('suppliers', i.supplierId)?.name || '—') : '—'; };
    const rows = all.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter(p => matches({ ...p, inv: invOf(p)?.number || '', sup: supName(p) }, q, ['inv', 'sup', 'method', 'reference', 'notes']));
    const year = String(new Date().getFullYear());
    const month = today().slice(0, 7);
    el.innerHTML = `
      <div class="stats">
        ${statCard('Payé ce mois-ci', money(all.filter(p => (p.date || '').startsWith(month)).reduce((t, p) => t + (Number(p.amount) || 0), 0)))}
        ${statCard('Payé cette année', money(all.filter(p => (p.date || '').startsWith(year)).reduce((t, p) => t + (Number(p.amount) || 0), 0)))}
        ${statCard('Paiements enregistrés', all.length)}
      </div>
      <div class="card">
        <div class="page-head">
          <div><h2>Paiements</h2><div class="subtitle">Historique des règlements fournisseurs</div></div>
          <div class="actions"><button class="btn" data-export>Exporter CSV</button><button class="btn primary" data-new>+ Enregistrer un paiement</button></div>
        </div>
        <div class="toolbar"><input type="search" class="search" data-search placeholder="Rechercher (facture, fournisseur, référence…)" value="${esc(q)}"></div>
        ${table({
          columns: [
            { label: 'Date', render: p => dateFmt(p.date) },
            { label: 'Facture', render: p => { const i = invOf(p); return i ? `<a href="#/invoices/${i.id}">${esc(i.number)}</a>` : '<span class="muted">Facture supprimée</span>'; } },
            { label: 'Fournisseur', render: p => esc(supName(p)) },
            { label: 'Méthode', render: p => badge(p.method || '—', 'purple') },
            { label: 'Référence', key: 'reference' },
            { label: 'Statut facture', render: p => { const i = invOf(p); if (!i) return ''; const s = invoiceStatus(i); return badge(s.label, s.kind); } },
            { label: 'Montant', align: 'num', render: p => `<b>${money(p.amount)}</b>` },
            { label: '', render: p => `<div class="row-actions"><button class="btn" data-del="${p.id}">Supprimer</button></div>` },
          ], rows, empty: all.length ? 'Aucun paiement ne correspond.' : 'Aucun paiement enregistré.'
        })}
      </div>`;
    el.querySelector('[data-search]').addEventListener('change', e => ctx.navigate('payments', '', { q: e.target.value }));
    el.querySelector('[data-new]').addEventListener('click', () => openPaymentForm(null));
    el.querySelector('[data-export]').addEventListener('click', () => download('paiements-dermagen-' + today() + '.csv', toCSV(rows, [
      { label: 'Date', value: 'date' }, { label: 'Facture', value: p => invOf(p)?.number || '' }, { label: 'Fournisseur', value: p => supName(p) },
      { label: 'Méthode', value: 'method' }, { label: 'Référence', value: 'reference' }, { label: 'Montant', value: 'amount' }, { label: 'Notes', value: 'notes' }
    ]), 'text/csv'));
    el.addEventListener('click', async e => {
      const b = e.target.closest('button[data-del]');
      if (b && await confirmDialog('Supprimer ce paiement ? Le solde de la facture sera recalculé.', { label: 'Supprimer' })) { db.remove('payments', b.dataset.del); toast('Paiement supprimé'); }
    });
  }
};
