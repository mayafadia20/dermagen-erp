// Paramètres : entreprise, taxes, listes, sauvegarde / restauration.
import { db, DEFAULT_SETTINGS } from '../store.js';
import { esc, toast, confirmDialog, field, download, today } from '../ui.js';
import { seedDemo } from '../seed.js';

const lines = (arr) => (arr || []).join('\n');
const parseLines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

export default {
  title: 'Paramètres & sauvegarde',
  render(el, ctx) {
    const s = db.settings();
    const counts = ['ingredients', 'movements', 'formulations', 'suppliers', 'purchases', 'invoices', 'payments'].map(c => `${db.all(c).length} ${c}`).join(' · ');
    el.innerHTML = `
      <div class="grid two">
        <div class="card">
          <h2>Entreprise & taxes</h2>
          <form data-company class="form-grid" style="margin-top:14px">
            ${field({ label: 'Nom de l’entreprise', name: 'company', value: s.company, cols: 4 })}
            ${field({ label: 'Adresse', name: 'address', value: s.address, cols: 4 })}
            ${field({ label: 'Courriel', name: 'email', type: 'email', value: s.email, cols: 2 })}
            ${field({ label: 'Devise', name: 'currency', type: 'select', options: ['CAD', 'USD', 'EUR'], value: s.currency, cols: 2 })}
            ${field({ label: 'TPS (%)', name: 'tps', type: 'number', step: '0.001', value: s.tps, cols: 1 })}
            ${field({ label: 'TVQ (%)', name: 'tvq', type: 'number', step: '0.001', value: s.tvq, cols: 1 })}
            ${field({ label: 'Alerte péremption (jours)', name: 'lowStockDays', type: 'number', min: 0, value: s.lowStockDays, cols: 2 })}
            <div class="field cols-4"><button type="submit" class="btn primary">Enregistrer</button></div>
          </form>
        </div>
        <div class="card">
          <h2>Listes personnalisables</h2>
          <p class="muted" style="margin:6px 0 12px">Une valeur par ligne.</p>
          <form data-lists class="form-grid">
            ${field({ label: 'Catégories d’ingrédients', name: 'categories', type: 'textarea', rows: 6, value: lines(s.categories), cols: 2 })}
            ${field({ label: 'Types de produits', name: 'productTypes', type: 'textarea', rows: 6, value: lines(s.productTypes), cols: 2 })}
            ${field({ label: 'Unités de stock', name: 'units', type: 'textarea', rows: 4, value: lines(s.units), cols: 1 })}
            ${field({ label: 'Méthodes de paiement', name: 'paymentMethods', type: 'textarea', rows: 4, value: lines(s.paymentMethods), cols: 2 })}
            ${field({ label: 'Conditions de paiement', name: 'paymentTerms', type: 'textarea', rows: 4, value: lines(s.paymentTerms), cols: 1 })}
            <div class="field cols-4"><button type="submit" class="btn primary">Enregistrer les listes</button></div>
          </form>
        </div>
        <div class="card">
          <h2>Sauvegarde & restauration</h2>
          <p class="muted" style="margin:6px 0 12px">Les données sont stockées dans ce navigateur (IndexedDB). Exportez régulièrement une sauvegarde JSON et conservez-la (OneDrive, Google Drive…). Pour travailler sur un autre ordinateur, importez cette sauvegarde.</p>
          <p><b>Contenu actuel :</b> <span class="muted">${esc(counts)}</span></p>
          <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn primary" data-export>⬇ Exporter la sauvegarde (JSON)</button>
            <label class="btn">⬆ Importer une sauvegarde <input type="file" accept="application/json,.json" data-import hidden></label>
          </div>
        </div>
        <div class="card">
          <h2>Données de démonstration & réinitialisation</h2>
          <p class="muted" style="margin:6px 0 12px">Le jeu de démonstration ajoute des fournisseurs, ingrédients, formulations, commandes et factures fictifs pour explorer l’outil.</p>
          <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn" data-seed>Charger les données de démonstration</button>
            <button class="btn danger" data-reset>Tout effacer</button>
          </div>
        </div>
      </div>
      <div class="card"><h3>À propos</h3><p class="muted" style="margin-top:6px">DermaGen ERP — inventaire des ingrédients, formulations R&D, fournisseurs, achats, factures et paiements. Application web sans serveur, hébergée sur GitHub Pages. Version 1.0 · ${today()}</p></div>`;

    el.querySelector('[data-company]').addEventListener('submit', e => {
      e.preventDefault(); const f = e.target;
      db.saveSettings({ company: f.company.value, address: f.address.value, email: f.email.value, currency: f.currency.value, tps: Number(f.tps.value) || 0, tvq: Number(f.tvq.value) || 0, lowStockDays: Number(f.lowStockDays.value) || 0 });
      toast('Paramètres enregistrés');
    });
    el.querySelector('[data-lists]').addEventListener('submit', e => {
      e.preventDefault(); const f = e.target;
      const patch = {};
      for (const k of ['categories', 'productTypes', 'units', 'paymentMethods', 'paymentTerms']) patch[k] = parseLines(f[k].value).length ? parseLines(f[k].value) : DEFAULT_SETTINGS[k];
      db.saveSettings(patch); toast('Listes enregistrées');
    });
    el.querySelector('[data-export]').addEventListener('click', () => download(`dermagen-erp-sauvegarde-${today()}.json`, db.exportJSON()));
    el.querySelector('[data-import]').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      if (!await confirmDialog(`Importer « ${file.name} » ? Les données actuelles seront remplacées par celles de la sauvegarde.`, { label: 'Importer' })) { e.target.value = ''; return; }
      try { await db.importJSON(await file.text()); toast('Sauvegarde importée'); ctx.navigate('dashboard'); }
      catch (err) { toast('Fichier invalide : ' + err.message, 'err'); }
      e.target.value = '';
    });
    el.querySelector('[data-seed]').addEventListener('click', () => seedDemo());
    el.querySelector('[data-reset]').addEventListener('click', async () => {
      if (await confirmDialog('Effacer TOUTES les données de l’ERP dans ce navigateur ? Cette action est irréversible (exportez d’abord une sauvegarde).', { label: 'Tout effacer' })) { await db.reset(); toast('Données effacées'); ctx.navigate('dashboard'); }
    });
  }
};
