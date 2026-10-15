// Migrations de données : opérations à exécuter une seule fois sur la base (locale ou en ligne).
// Chaque migration est identifiée ; celles déjà faites sont notées dans les réglages (`migrationsDone`),
// partagés par toute l'équipe en mode en ligne.
import { db } from './store.js';
import { cloud } from './cloud.js';
import { isReadOnly } from './auth.js';

const MIGRATIONS = [
  {
    id: 'vider-listes-2026-10-15',
    // Demande du 15 oct. 2026 : repartir avec des listes vides (fournisseurs, bons de commande, factures,
    // paiements, demandes d'accélérateurs) — les données de démonstration n'ont plus leur place.
    run() {
      let n = 0;
      for (const col of ['payments', 'invoices', 'purchases', 'suppliers', 'accelerators']) {
        for (const rec of db.all(col).slice()) { db.remove(col, rec.id); n++; }
      }
      return n;
    }
  }
];

/** À appeler au démarrage, après la synchronisation. En ligne, on n'agit que si la base a bien été chargée. */
export function runMigrations({ synced = false } = {}) {
  if (isReadOnly()) return;
  if (cloud.enabled() && !synced) return;
  const done = new Set(db.settings().migrationsDone || []);
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    done.add(m.id);
    db.saveSettings({ migrationsDone: [...done] });   // noté avant d'agir : jamais exécutée deux fois
    const n = m.run();
    console.info(`Migration ${m.id} : ${n} enregistrement(s) touché(s)`);
  }
}
