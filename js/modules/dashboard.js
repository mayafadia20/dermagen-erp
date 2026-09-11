// Tableau de bord : indicateurs clés et alertes.
import { db } from '../store.js';
import { esc, money, num, dateFmt, today, isoWeek, daysUntil, badge, table, statCard } from '../ui.js';
import { stockStatus, inventoryValue } from './ingredients.js';
import { invoiceStatus, invoiceBalance } from './invoices.js';
import { seedDemo } from '../seed.js';

export default {
  title: 'Tableau de bord',
  render(el, ctx) {
    const ings = db.all('ingredients'), forms = db.all('formulations'), invs = db.all('invoices').filter(i => !i.cancelled), pos = db.all('purchases');
    const alerts = ings.map(i => ({ i, st: stockStatus(i) })).filter(x => x.st.kind !== 'green').sort((a, b) => (a.st.kind === 'red' ? 0 : 1) - (b.st.kind === 'red' ? 0 : 1));
    const week = isoWeek(today());
    const weekForms = forms.filter(f => (f.weekKey || isoWeek(f.date).key) === week.key);
    const openInvs = invs.filter(i => invoiceBalance(i) > 0).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const due = openInvs.reduce((t, i) => t + invoiceBalance(i), 0);
    const late = openInvs.filter(i => invoiceStatus(i).key === 'late');
    const pendingPO = pos.filter(p => p.status === 'Envoyée').sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''));
    const recentForms = forms.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);
    const empty = !ings.length && !forms.length && !db.all('suppliers').length;

    el.innerHTML = `
      ${empty ? `<div class="card"><h2>Bienvenue dans l’ERP DermaGen</h2><p style="margin-top:8px">Commencez par créer vos <a href="#/suppliers">fournisseurs</a> et vos <a href="#/ingredients">ingrédients</a>, puis consignez vos <a href="#/formulations">formulations hebdomadaires</a>. Vous pouvez aussi charger un jeu de données de démonstration pour explorer l’outil.</p><p><button class="btn primary" data-seed>Charger des données de démonstration</button></p></div>` : ''}
      <div class="stats">
        ${statCard('Valeur de l’inventaire', money(inventoryValue()), ings.length + ' ingrédient(s)')}
        ${statCard('Alertes de stock', alerts.length, alerts.length ? 'bas, rupture ou péremption' : 'tout est en ordre', alerts.length ? 'warn' : 'good')}
        ${statCard('Formulations cette semaine', weekForms.length, week.label)}
        ${statCard('Commandes en attente', pendingPO.length, money(pendingPO.reduce((t, p) => t + (Number(p.total) || 0), 0)))}
        ${statCard('Solde fournisseurs à payer', money(due), openInvs.length + ' facture(s)', late.length ? 'danger' : due > 0 ? 'warn' : 'good')}
        ${statCard('Factures en retard', late.length, money(late.reduce((t, i) => t + invoiceBalance(i), 0)), late.length ? 'danger' : 'good')}
      </div>
      <div class="grid two">
        <div class="card">
          <div class="card-head"><h3>Alertes d’inventaire</h3><a href="#/ingredients?only=alert" class="muted">Tout voir →</a></div>
          ${table({ columns: [
            { label: 'Ingrédient', render: x => `<a href="#/ingredients/${x.i.id}">${esc(x.i.name)}</a>` },
            { label: 'Stock', align: 'num', render: x => `${num(x.i.stock, 3)} ${esc(x.i.unit)}${x.i.minStock ? `<div class="muted">min ${num(x.i.minStock, 3)}</div>` : ''}` },
            { label: 'Statut', render: x => badge(x.st.label, x.st.kind) },
          ], rows: alerts.slice(0, 8), empty: 'Aucune alerte : stocks et péremptions sous contrôle.' })}
        </div>
        <div class="card">
          <div class="card-head"><h3>Factures à payer</h3><a href="#/invoices" class="muted">Tout voir →</a></div>
          ${table({ columns: [
            { label: 'Facture', render: i => `<a href="#/invoices/${i.id}">${esc(i.number)}</a><div class="muted">${esc(db.get('suppliers', i.supplierId)?.name || '')}</div>` },
            { label: 'Échéance', render: i => { const d = daysUntil(i.dueDate); return `${dateFmt(i.dueDate)}<div class="muted">${d < 0 ? `en retard de ${-d} j` : d === 0 ? 'aujourd’hui' : `dans ${d} j`}</div>`; } },
            { label: 'Solde', align: 'num', render: i => `<b>${money(invoiceBalance(i))}</b>` },
            { label: '', render: i => { const s = invoiceStatus(i); return badge(s.label, s.kind); } },
          ], rows: openInvs.slice(0, 8), empty: 'Aucune facture en attente.' })}
        </div>
        <div class="card">
          <div class="card-head"><h3>Dernières formulations</h3><a href="#/formulations" class="muted">Tout voir →</a></div>
          ${table({ columns: [
            { label: 'Code', render: f => `<a href="#/formulations/${f.id}">${esc(f.code)}</a>` },
            { label: 'Nom', render: f => `${esc(f.name)}<div class="muted">${esc(f.productType || '')}</div>` },
            { label: 'Date', render: f => dateFmt(f.date) },
            { label: 'Statut', render: f => badge(f.status, { 'En développement': 'blue', 'En test': 'amber', 'Validée': 'green' }[f.status] || 'grey') },
          ], rows: recentForms, empty: 'Aucune formulation consignée.' })}
        </div>
        <div class="card">
          <div class="card-head"><h3>Livraisons attendues</h3><a href="#/purchases" class="muted">Tout voir →</a></div>
          ${table({ columns: [
            { label: 'Commande', render: p => `<a href="#/purchases/${p.id}">${esc(p.number)}</a><div class="muted">${esc(db.get('suppliers', p.supplierId)?.name || '')}</div>` },
            { label: 'Prévue', render: p => { const d = daysUntil(p.expectedDate); return `${dateFmt(p.expectedDate)}${p.expectedDate && d < 0 ? `<div class="pct-bad">retard ${-d} j</div>` : ''}`; } },
            { label: 'Total', align: 'num', render: p => money(p.total) },
          ], rows: pendingPO.slice(0, 8), empty: 'Aucune commande en attente de livraison.' })}
        </div>
      </div>`;
    el.querySelector('[data-seed]')?.addEventListener('click', () => seedDemo());
  }
};
