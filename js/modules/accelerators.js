// Demandes d'accélérateurs : suivi des candidatures aux programmes (accélérateurs, incubateurs, subventions, concours).
import { db } from '../store.js';
import { esc, money, dateFmt, today, daysUntil, toast, badge, openModal, confirmDialog, field, table, matches, statCard, download, toCSV } from '../ui.js';

export const ACC_STATUSES = ['À évaluer', 'En préparation', 'Soumise', 'Entrevue / sélection', 'Acceptée', 'Refusée', 'Abandonnée'];
const KIND = { 'À évaluer': 'grey', 'En préparation': 'blue', 'Soumise': 'amber', 'Entrevue / sélection': 'purple', 'Acceptée': 'green', 'Refusée': 'red', 'Abandonnée': 'grey' };
const ACTIVE = ['À évaluer', 'En préparation', 'Soumise', 'Entrevue / sélection'];
const PRIORITIES = ['Haute', 'Moyenne', 'Basse'];

export function openAcceleratorForm(existing, onDone) {
  const s = db.settings();
  const a = existing || { type: s.acceleratorTypes[0], status: 'À évaluer', priority: 'Moyenne' };
  openModal({
    title: existing ? 'Modifier la demande' : 'Nouvelle demande', wide: true,
    body: `<div class="form-grid">
      ${field({ label: 'Programme', name: 'program', value: a.program, required: true, cols: 2, placeholder: 'ex. Centech Propulsion, District 3, MT Lab' })}
      ${field({ label: 'Organisation', name: 'organization', value: a.organization, cols: 2, placeholder: 'ex. ÉTS, Concordia, Investissement Québec' })}
      ${field({ label: 'Type', name: 'type', type: 'select', options: s.acceleratorTypes, value: a.type, cols: 1 })}
      ${field({ label: 'Statut', name: 'status', type: 'select', options: ACC_STATUSES, value: a.status, cols: 1 })}
      ${field({ label: 'Priorité', name: 'priority', type: 'select', options: PRIORITIES, value: a.priority, cols: 1 })}
      ${field({ label: 'Cohorte / édition', name: 'cohort', value: a.cohort, cols: 1, placeholder: 'ex. Hiver 2027' })}
      ${field({ label: 'Site web / lien de candidature', name: 'website', type: 'url', value: a.website, cols: 4, placeholder: 'https://' })}
      <div class="form-section">Dates</div>
      ${field({ label: 'Date limite de dépôt', name: 'deadline', type: 'date', value: a.deadline, cols: 1 })}
      ${field({ label: 'Date de soumission', name: 'submittedAt', type: 'date', value: a.submittedAt, cols: 1 })}
      ${field({ label: 'Début du programme', name: 'startDate', type: 'date', value: a.startDate, cols: 1 })}
      ${field({ label: 'Durée', name: 'duration', value: a.duration, cols: 1, placeholder: 'ex. 12 semaines' })}
      <div class="form-section">Valeur & conditions</div>
      ${field({ label: 'Montant / valeur (CAD)', name: 'amount', type: 'number', step: '1', min: 0, value: a.amount, cols: 1 })}
      ${field({ label: 'Participation (equity %)', name: 'equity', type: 'number', step: '0.1', min: 0, value: a.equity, cols: 1 })}
      ${field({ label: 'Frais de participation', name: 'fees', type: 'number', step: '1', min: 0, value: a.fees, cols: 1 })}
      ${field({ label: 'Avantages (mentorat, bureaux, réseau…)', name: 'benefits', value: a.benefits, cols: 1 })}
      <div class="form-section">Contact</div>
      ${field({ label: 'Personne-contact', name: 'contactName', value: a.contactName, cols: 2 })}
      ${field({ label: 'Courriel', name: 'contactEmail', type: 'email', value: a.contactEmail, cols: 1 })}
      ${field({ label: 'Téléphone', name: 'contactPhone', value: a.contactPhone, cols: 1 })}
      <div class="form-section">Dossier</div>
      ${field({ label: 'Critères d’admissibilité', name: 'eligibility', type: 'textarea', rows: 2, value: a.eligibility, cols: 4 })}
      ${field({ label: 'Documents requis (un par ligne, préfixer par [x] quand c’est fait)', name: 'requirements', type: 'textarea', rows: 4, value: a.requirements, cols: 4, placeholder: '[ ] Plan d’affaires\n[ ] Pitch deck\n[ ] États financiers\n[x] Vidéo de présentation' })}
      ${field({ label: 'Prochaine étape', name: 'nextStep', value: a.nextStep, cols: 4, placeholder: 'ex. Finaliser le pitch deck avant le 20 septembre' })}
      ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 3, value: a.notes, cols: 4 })}
    </div>`,
    submitLabel: existing ? 'Enregistrer' : 'Créer la demande',
    onSubmit(d) {
      if (existing) {
        const journal = existing.journal || [];
        if (d.status !== existing.status) journal.push({ date: today(), text: `Statut : ${existing.status} → ${d.status}` });
        db.update('accelerators', existing.id, { ...d, journal }); toast('Demande mise à jour'); onDone && onDone(existing.id);
      } else { const r = db.insert('accelerators', { ...d, journal: [{ date: today(), text: 'Demande créée' }] }); toast('Demande créée'); onDone && onDone(r.id); }
    }
  });
}

function reqProgress(a) {
  const lines = String(a.requirements || '').split('\n').map(x => x.trim()).filter(Boolean);
  const done = lines.filter(x => /^\[x\]/i.test(x)).length;
  return { total: lines.length, done };
}
function deadlineCell(a) {
  if (!a.deadline) return '<span class="muted">—</span>';
  const d = daysUntil(a.deadline);
  const active = ACTIVE.includes(a.status) && a.status !== 'Soumise' && a.status !== 'Entrevue / sélection';
  let sub = '';
  if (active) sub = d < 0 ? `<div class="pct-bad">dépassée de ${-d} j</div>` : d === 0 ? '<div class="pct-bad">aujourd’hui</div>' : d <= 14 ? `<div class="pct-bad">J-${d}</div>` : `<div class="muted">J-${d}</div>`;
  return dateFmt(a.deadline) + sub;
}

function renderList(el, ctx) {
  const s = db.settings();
  const q = ctx.params.q || '', st = ctx.params.status || '', type = ctx.params.type || '';
  const all = db.all('accelerators');
  let rows = all.filter(a => matches(a, q, ['program', 'organization', 'type', 'notes', 'contactName', 'cohort']));
  if (st === 'active') rows = rows.filter(a => ACTIVE.includes(a.status)); else if (st) rows = rows.filter(a => a.status === st);
  if (type) rows = rows.filter(a => a.type === type);
  rows.sort((a, b) => {
    const ia = ACTIVE.includes(a.status) ? 0 : 1, ib = ACTIVE.includes(b.status) ? 0 : 1;
    if (ia !== ib) return ia - ib;
    return (a.deadline || '9999').localeCompare(b.deadline || '9999');
  });
  const active = all.filter(a => ACTIVE.includes(a.status));
  const soon = active.filter(a => a.deadline && daysUntil(a.deadline) >= 0 && daysUntil(a.deadline) <= 30 && (a.status === 'À évaluer' || a.status === 'En préparation'));
  const accepted = all.filter(a => a.status === 'Acceptée');
  el.innerHTML = `
    <div class="stats">
      ${statCard('Demandes en cours', active.length, all.length + ' au total')}
      ${statCard('Échéances sous 30 jours', soon.length, soon.length ? 'à soumettre' : '', soon.length ? 'warn' : '')}
      ${statCard('Acceptées', accepted.length, money(accepted.reduce((t, a) => t + (Number(a.amount) || 0), 0)) + ' obtenus', accepted.length ? 'good' : '')}
      ${statCard('Valeur potentielle', money(active.reduce((t, a) => t + (Number(a.amount) || 0), 0)), 'demandes en cours')}
    </div>
    <div class="card">
      <div class="page-head">
        <div><h2>Demandes d’accélérateurs</h2><div class="subtitle">Accélérateurs, incubateurs, subventions et concours</div></div>
        <div class="actions"><button class="btn" data-export>Exporter CSV</button><button class="btn primary" data-new>+ Nouvelle demande</button></div>
      </div>
      <div class="toolbar">
        <input type="search" class="search" data-search placeholder="Rechercher (programme, organisation…)" value="${esc(q)}">
        <select data-status><option value="">Tous les statuts</option><option value="active" ${st === 'active' ? 'selected' : ''}>En cours</option>${ACC_STATUSES.map(x => `<option ${x === st ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select data-type><option value="">Tous les types</option>${s.acceleratorTypes.map(x => `<option ${x === type ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>
      ${table({
        columns: [
          { label: 'Programme', render: a => `<div class="strong">${esc(a.program)}</div><div class="muted">${esc([a.organization, a.cohort].filter(Boolean).join(' · '))}</div>` },
          { label: 'Type', render: a => badge(a.type || '—', 'grey') },
          { label: 'Priorité', render: a => badge(a.priority || '—', a.priority === 'Haute' ? 'red' : a.priority === 'Basse' ? 'grey' : 'amber') },
          { label: 'Date limite', render: deadlineCell },
          { label: 'Dossier', render: a => { const p = reqProgress(a); return p.total ? `<div class="progress" title="${p.done}/${p.total}"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></div><div class="muted">${p.done}/${p.total} documents</div>` : '<span class="muted">—</span>'; } },
          { label: 'Valeur', align: 'num', render: a => a.amount ? money(a.amount) + (a.equity ? `<div class="muted">${a.equity} % equity</div>` : '') : '<span class="muted">—</span>' },
          { label: 'Prochaine étape', render: a => `<span class="muted">${esc(a.nextStep || '')}</span>` },
          { label: 'Statut', render: a => badge(a.status, KIND[a.status] || 'grey') },
        ], rows, empty: all.length ? 'Aucune demande ne correspond.' : 'Aucune demande. Ajoutez les programmes que vous ciblez (Centech, District 3, MT Lab, CDL, subventions…).',
        rowAttrs: a => `class="clickable" data-open="${a.id}"`
      })}
    </div>`;
  const go = (patch) => ctx.navigate('accelerators', '', { q, status: st, type, ...patch });
  el.querySelector('[data-search]').addEventListener('change', e => go({ q: e.target.value }));
  el.querySelector('[data-status]').addEventListener('change', e => go({ status: e.target.value }));
  el.querySelector('[data-type]').addEventListener('change', e => go({ type: e.target.value }));
  el.querySelector('[data-new]').addEventListener('click', () => openAcceleratorForm(null, id => ctx.navigate('accelerators', id)));
  el.querySelector('[data-export]').addEventListener('click', () => download('accelerateurs-dermagen-' + today() + '.csv', toCSV(rows, [
    { label: 'Programme', value: 'program' }, { label: 'Organisation', value: 'organization' }, { label: 'Type', value: 'type' }, { label: 'Statut', value: 'status' }, { label: 'Priorité', value: 'priority' },
    { label: 'Date limite', value: 'deadline' }, { label: 'Soumise le', value: 'submittedAt' }, { label: 'Montant', value: 'amount' }, { label: 'Equity %', value: 'equity' }, { label: 'Contact', value: 'contactName' }, { label: 'Courriel', value: 'contactEmail' }, { label: 'Site', value: 'website' }, { label: 'Prochaine étape', value: 'nextStep' }, { label: 'Notes', value: 'notes' }
  ]), 'text/csv'));
  el.addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-open]'); if (tr) ctx.navigate('accelerators', tr.dataset.open); });
}

function renderDetail(el, ctx, a) {
  const p = reqProgress(a);
  const reqLines = String(a.requirements || '').split('\n').map(x => x.trim()).filter(Boolean);
  const journal = (a.journal || []).slice().reverse();
  el.innerHTML = `
    <a href="#/accelerators" class="back">← Retour aux demandes</a>
    <div class="card">
      <div class="page-head">
        <div><h2>${esc(a.program)} ${badge(a.status, KIND[a.status] || 'grey')} ${badge(a.priority || 'Moyenne', a.priority === 'Haute' ? 'red' : a.priority === 'Basse' ? 'grey' : 'amber')}</h2>
          <div class="subtitle">${esc([a.organization, a.type, a.cohort].filter(Boolean).join(' · '))}${a.website ? ` · <a href="${esc(a.website)}" target="_blank" rel="noopener">site / candidature ↗</a>` : ''}</div></div>
        <div class="actions">
          <select data-quick-status title="Changer le statut">${ACC_STATUSES.map(x => `<option ${x === a.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <button class="btn" data-edit>Modifier</button>
          <button class="btn danger" data-del>Supprimer</button>
        </div>
      </div>
      ${a.nextStep ? `<div class="info"><b>Prochaine étape :</b> ${esc(a.nextStep)}</div>` : ''}
      <dl class="detail-grid">
        <div><dt>Date limite</dt><dd>${deadlineCell(a)}</dd></div>
        <div><dt>Soumise le</dt><dd>${dateFmt(a.submittedAt)}</dd></div>
        <div><dt>Début du programme</dt><dd>${dateFmt(a.startDate)}${a.duration ? ` <span class="muted">· ${esc(a.duration)}</span>` : ''}</dd></div>
        <div><dt>Montant / valeur</dt><dd>${a.amount ? money(a.amount) : '—'}</dd></div>
        <div><dt>Equity</dt><dd>${a.equity ? a.equity + ' %' : '—'}</dd></div>
        <div><dt>Frais</dt><dd>${a.fees ? money(a.fees) : '—'}</dd></div>
        <div><dt>Avantages</dt><dd>${esc(a.benefits || '—')}</dd></div>
        <div><dt>Contact</dt><dd>${esc(a.contactName || '—')}${a.contactEmail ? ` · <a href="mailto:${esc(a.contactEmail)}">${esc(a.contactEmail)}</a>` : ''}${a.contactPhone ? ` · ${esc(a.contactPhone)}` : ''}</dd></div>
      </dl>
      ${a.eligibility ? `<h3 style="margin:16px 0 6px">Critères d’admissibilité</h3><p style="white-space:pre-wrap">${esc(a.eligibility)}</p>` : ''}
      ${a.notes ? `<h3 style="margin:16px 0 6px">Notes</h3><p style="white-space:pre-wrap">${esc(a.notes)}</p>` : ''}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h3>Documents du dossier</h3><span class="muted">${p.done}/${p.total}</span></div>
        ${p.total ? `<div class="progress" style="margin-bottom:12px"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></div>
        <ul class="checklist">${reqLines.map((l, i) => { const done = /^\[x\]/i.test(l); return `<li><label class="check" style="padding:4px 0"><input type="checkbox" data-req="${i}" ${done ? 'checked' : ''}> <span class="${done ? 'muted' : ''}">${esc(l.replace(/^\[[ x]?\]\s*/i, ''))}</span></label></li>`; }).join('')}</ul>` : '<div class="empty">Aucun document listé. Modifiez la demande pour ajouter la liste des documents requis.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Journal de suivi</h3></div>
        <form data-journal style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <input type="date" name="date" value="${today()}" style="width:160px">
          <input name="text" placeholder="ex. Appel avec la responsable du programme…" required style="flex:1;min-width:200px">
          <button type="submit" class="btn">Ajouter</button>
        </form>
        <ul class="timeline">${journal.length ? journal.map(j => `<li><span class="when">${dateFmt(j.date)}</span><span>${esc(j.text)}</span></li>`).join('') : '<li class="muted">Aucune entrée.</li>'}</ul>
      </div>
    </div>`;
  el.querySelector('[data-edit]').addEventListener('click', () => openAcceleratorForm(a));
  el.querySelector('[data-quick-status]').addEventListener('change', e => {
    const journal = [...(a.journal || []), { date: today(), text: `Statut : ${a.status} → ${e.target.value}` }];
    const patch = { status: e.target.value, journal };
    if (e.target.value === 'Soumise' && !a.submittedAt) patch.submittedAt = today();
    db.update('accelerators', a.id, patch); toast('Statut mis à jour');
  });
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`Supprimer la demande « ${a.program} » ?`, { label: 'Supprimer' })) { db.remove('accelerators', a.id); toast('Demande supprimée'); ctx.navigate('accelerators'); }
  });
  el.querySelector('[data-journal]').addEventListener('submit', e => {
    e.preventDefault(); const f = e.target;
    db.update('accelerators', a.id, { journal: [...(a.journal || []), { date: f.date.value || today(), text: f.text.value.trim() }] }); toast('Entrée ajoutée');
  });
  el.addEventListener('change', e => {
    const cb = e.target.closest('[data-req]'); if (!cb) return;
    const i = +cb.dataset.req;
    const lines = String(a.requirements || '').split('\n');
    let k = -1;
    const updated = lines.map(l => { if (!l.trim()) return l; k++; if (k !== i) return l; const body = l.trim().replace(/^\[[ x]?\]\s*/i, ''); return (cb.checked ? '[x] ' : '[ ] ') + body; });
    db.update('accelerators', a.id, { requirements: updated.join('\n') });
  });
}

export default {
  title: 'Demandes d’accélérateurs',
  render(el, ctx) {
    if (ctx.id) { const a = db.get('accelerators', ctx.id); if (a) return renderDetail(el, ctx, a); }
    renderList(el, ctx);
  }
};
