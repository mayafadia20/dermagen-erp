// Fournisseurs : carnet de contacts, conditions, historique d'achats.
import { db } from '../store.js';
import { esc, money, dateFmt, num, toast, badge, openModal, confirmDialog, field, table, matches, download, toCSV, today, statCard } from '../ui.js';
import { invoiceStatus, invoicePaid } from './invoices.js';

export function openSupplierForm(existing, onDone) {
  const s = db.settings();
  const sup = existing || { country: 'Canada', province: 'Québec', currency: s.currency, paymentTerms: 'Net 30' };
  openModal({
    title: existing ? 'Modifier le fournisseur' : 'Nouveau fournisseur', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'Entreprise', name: 'name', value: sup.name, required: true, cols: 2 })}
      ${field({ label: 'Site web', name: 'website', value: sup.website, cols: 2, placeholder: 'https://' })}
      ${field({ label: 'Personne-contact', name: 'contactName', value: sup.contactName, cols: 2 })}
      ${field({ label: 'Poste', name: 'contactTitle', value: sup.contactTitle, cols: 2, placeholder: 'ex. Représentant·e des ventes' })}
      ${field({ label: 'Courriel', name: 'email', type: 'email', value: sup.email, cols: 2 })}
      ${field({ label: 'Téléphone', name: 'phone', value: sup.phone, cols: 2 })}
      <div class="form-section">Adresse</div>
      ${field({ label: 'Adresse', name: 'address', value: sup.address, cols: 4 })}
      ${field({ label: 'Ville', name: 'city', value: sup.city, cols: 2 })}
      ${field({ label: 'Province / État', name: 'province', value: sup.province, cols: 1 })}
      ${field({ label: 'Pays', name: 'country', value: sup.country, cols: 1 })}
      <div class="form-section">Conditions commerciales</div>
      ${field({ label: 'Conditions de paiement', name: 'paymentTerms', type: 'select', options: s.paymentTerms, value: sup.paymentTerms, cols: 1 })}
      ${field({ label: 'Devise', name: 'currency', type: 'select', options: ['CAD', 'USD', 'EUR'], value: sup.currency, cols: 1 })}
      ${field({ label: 'N° de compte client', name: 'accountNumber', value: sup.accountNumber, cols: 1 })}
      ${field({ label: 'Délai de livraison (jours)', name: 'leadTime', type: 'number', min: 0, value: sup.leadTime, cols: 1 })}
      ${field({ label: 'Produits / catégories fournis', name: 'categories', value: sup.categories, cols: 4, placeholder: 'ex. Actifs, tensioactifs, emballages' })}
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: sup.notes, cols: 4, placeholder: 'Minimum de commande, frais de port, qualité, historique…' })}
    </div>`,
    onSubmit(data) {
      if (existing) { db.update('suppliers', existing.id, data); toast('Fournisseur mis à jour'); onDone && onDone(existing.id); }
      else { const r = db.insert('suppliers', data); toast('Fournisseur créé'); onDone && onDone(r.id); }
    }
  });
}

function renderList(el, ctx) {
  const q = ctx.params.q || '';
  const all = db.all('suppliers');
  const rows = all.filter(r => matches(r, q, ['name', 'contactName', 'email', 'phone', 'city', 'categories', 'notes'])).sort((a, b) => a.name.localeCompare(b.name));
  const spent = (id) => db.all('invoices').filter(i => i.supplierId === id).reduce((t, i) => t + (Number(i.total) || 0), 0);
  el.innerHTML = `
    <div class="card">
      <div class="page-head">
        <div><h2>Fournisseurs</h2><div class="subtitle">${all.length} fournisseur(s)</div></div>
        <div class="actions"><button class="btn" data-export>Exporter CSV</button><button class="btn primary" data-new>+ Nouveau fournisseur</button></div>
      </div>
      <div class="toolbar"><input type="search" class="search" data-search placeholder="Rechercher (entreprise, contact, ville…)" value="${esc(q)}"></div>
      ${table({
        columns: [
          { label: 'Entreprise', render: r => `<div class="strong">${esc(r.name)}</div><div class="muted">${esc(r.categories || '')}</div>` },
          { label: 'Contact', render: r => `${esc(r.contactName || '—')}${r.contactTitle ? `<div class="muted">${esc(r.contactTitle)}</div>` : ''}` },
          { label: 'Courriel', render: r => r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—' },
          { label: 'Téléphone', render: r => r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—' },
          { label: 'Ville', render: r => esc([r.city, r.country].filter(Boolean).join(', ')) },
          { label: 'Conditions', render: r => badge(r.paymentTerms || '—', 'grey') },
          { label: 'Ingrédients', align: 'num', render: r => db.all('ingredients').filter(i => i.supplierId === r.id).length },
          { label: 'Total facturé', align: 'num', render: r => money(spent(r.id)) },
          { label: '', render: r => `<div class="row-actions"><button class="btn" data-edit="${r.id}">Modifier</button></div>` },
        ], rows, empty: all.length ? 'Aucun fournisseur ne correspond.' : 'Aucun fournisseur enregistré.',
        rowAttrs: r => `class="clickable" data-open="${r.id}"`
      })}
    </div>`;
  el.querySelector('[data-search]').addEventListener('change', e => ctx.navigate('suppliers', '', { q: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openSupplierForm(null));
  el.querySelector('[data-export]').addEventListener('click', () => download('fournisseurs-dermagen-' + today() + '.csv', toCSV(rows, [
    { label: 'Entreprise', value: 'name' }, { label: 'Contact', value: 'contactName' }, { label: 'Poste', value: 'contactTitle' }, { label: 'Courriel', value: 'email' }, { label: 'Téléphone', value: 'phone' },
    { label: 'Adresse', value: 'address' }, { label: 'Ville', value: 'city' }, { label: 'Province', value: 'province' }, { label: 'Pays', value: 'country' }, { label: 'Site web', value: 'website' },
    { label: 'Conditions', value: 'paymentTerms' }, { label: 'Devise', value: 'currency' }, { label: 'Catégories', value: 'categories' }, { label: 'Notes', value: 'notes' }
  ]), 'text/csv'));
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-edit]');
    if (b) { e.stopPropagation(); return openSupplierForm(db.get('suppliers', b.dataset.edit)); }
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('suppliers', tr.dataset.open);
  });
}

function renderDetail(el, ctx, sup) {
  const ings = db.all('ingredients').filter(i => i.supplierId === sup.id);
  const pos = db.all('purchases').filter(p => p.supplierId === sup.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const invs = db.all('invoices').filter(i => i.supplierId === sup.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const due = invs.reduce((t, i) => t + Math.max(0, (Number(i.total) || 0) - invoicePaid(i)), 0);
  el.innerHTML = `
    <a href="#/suppliers" class="back">← Retour aux fournisseurs</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(sup.name)}</h2><div class="subtitle">${esc(sup.categories || '')}</div></div>
        <div class="actions">
          <button class="btn" data-po>+ Bon de commande</button>
          <button class="btn" data-edit>Modifier</button>
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      <dl class="detail-grid">
        <div><dt>Contact</dt><dd>${esc(sup.contactName || '—')}${sup.contactTitle ? ` <span class="muted">· ${esc(sup.contactTitle)}</span>` : ''}</dd></div>
        <div><dt>Courriel</dt><dd>${sup.email ? `<a href="mailto:${esc(sup.email)}">${esc(sup.email)}</a>` : '—'}</dd></div>
        <div><dt>Téléphone</dt><dd>${sup.phone ? `<a href="tel:${esc(sup.phone)}">${esc(sup.phone)}</a>` : '—'}</dd></div>
        <div><dt>Site web</dt><dd>${sup.website ? `<a href="${esc(sup.website)}" target="_blank" rel="noopener">${esc(sup.website)}</a>` : '—'}</dd></div>
        <div><dt>Adresse</dt><dd>${esc([sup.address, sup.city, sup.province, sup.country].filter(Boolean).join(', ') || '—')}</dd></div>
        <div><dt>Conditions</dt><dd>${esc(sup.paymentTerms || '—')} · ${esc(sup.currency || 'CAD')}</dd></div>
        <div><dt>N° de compte</dt><dd>${esc(sup.accountNumber || '—')}</dd></div>
        <div><dt>Délai de livraison</dt><dd>${sup.leadTime != null && sup.leadTime !== '' ? sup.leadTime + ' jours' : '—'}</dd></div>
      </dl>
      ${sup.notes ? `<p style="margin-top:14px;white-space:pre-wrap">${esc(sup.notes)}</p>` : ''}
    </div>
    <div class="stats">
      ${statCard('Ingrédients fournis', ings.length)}
      ${statCard('Bons de commande', pos.length)}
      ${statCard('Total facturé', money(invs.reduce((t, i) => t + (Number(i.total) || 0), 0)))}
      ${statCard('Solde dû', money(due), '', due > 0 ? 'warn' : 'good')}
    </div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h3>Ingrédients fournis</h3></div>
        ${table({ columns: [
          { label: 'Ingrédient', render: i => `<a href="#/ingredients/${i.id}">${esc(i.name)}</a>` },
          { label: 'Réf.', key: 'supplierRef' },
          { label: 'Stock', align: 'num', render: i => `${num(i.stock, 3)} ${esc(i.unit)}` },
          { label: 'Coût', align: 'num', render: i => money(i.cost) + '/' + esc(i.unit) },
        ], rows: ings, empty: 'Aucun ingrédient associé.' })}
      </div>
      <div class="card"><div class="card-head"><h3>Commandes & factures</h3></div>
        ${table({ columns: [
          { label: 'N° BC', render: p => `<a href="#/purchases/${p.id}">${esc(p.number)}</a>` },
          { label: 'Date', render: p => dateFmt(p.date) },
          { label: 'Statut', key: 'status' },
          { label: 'Total', align: 'num', render: p => money(p.total) },
        ], rows: pos, empty: 'Aucune commande.' })}
        <div style="height:14px"></div>
        ${table({ columns: [
          { label: 'Facture', render: i => `<a href="#/invoices/${i.id}">${esc(i.number)}</a>` },
          { label: 'Échéance', render: i => dateFmt(i.dueDate) },
          { label: 'Statut', render: i => { const s = invoiceStatus(i); return badge(s.label, s.kind); } },
          { label: 'Total', align: 'num', render: i => money(i.total) },
        ], rows: invs, empty: 'Aucune facture.' })}
      </div>
    </div>`;
  el.querySelector('[data-edit]').addEventListener('click', () => openSupplierForm(sup));
  el.querySelector('[data-po]').addEventListener('click', () => ctx.navigate('purchases', '', { new: '1', supplier: sup.id }));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer le fournisseur « ${sup.name} » ? Les ingrédients, commandes et factures liés seront conservés sans fournisseur.`, { label: 'Supprimer' })) {
      db.remove('suppliers', sup.id); toast('Fournisseur supprimé'); ctx.navigate('suppliers');
    }
  });
}

export default {
  title: 'Fournisseurs',
  render(el, ctx) {
    if (ctx.id) { const s = db.get('suppliers', ctx.id); if (s) return renderDetail(el, ctx, s); }
    renderList(el, ctx);
  }
};
