// Couche de persistance : état en mémoire, sauvegarde dans IndexedDB (navigateur).
// Chaque collection est un tableau d'objets avec un champ `id`.

const DB_NAME = 'dermagen-erp';
const DB_VERSION = 1;
const OBJECT_STORE = 'collections';

export const COLLECTIONS = [
  'ingredients', 'movements', 'formulations', 'suppliers',
  'purchases', 'invoices', 'payments', 'passwords', 'accelerators', 'settings'
];

export const DEFAULT_SETTINGS = {
  company: 'DermaGen',
  address: 'Montréal (Québec)',
  email: 'info@dermagen.ca',
  currency: 'CAD',
  tps: 5,
  tvq: 9.975,
  lowStockDays: 60,
  categories: ['Actif', 'Agent conditionneur', 'Tensioactif', 'Émollient', 'Huile', 'Beurre', 'Humectant', 'Épaississant', 'Conservateur', 'Parfum', 'Ajusteur de pH', 'Solvant', 'Emballage', 'Autre'],
  productTypes: ['Shampoing', 'Revitalisant', 'Masque', 'Traitement lissant', 'Sérum', 'Huile capillaire', 'Poudre de soin', 'Capsule', 'Autre'],
  units: ['g', 'kg', 'ml', 'L', 'unité'],
  paymentMethods: ['Virement bancaire', 'Carte de crédit', 'Interac', 'Chèque', 'PayPal', 'Comptant'],
  paymentTerms: ['Paiement à la commande', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
  passwordCategories: ['Banque & finances', 'Gouvernement', 'Fournisseurs', 'Logiciels & abonnements', 'Réseaux sociaux', 'Site web & domaine', 'Courriel', 'Autre'],
  acceleratorTypes: ['Accélérateur', 'Incubateur', 'Subvention', 'Concours', 'Financement', 'Programme de mentorat', 'Autre']
};

const state = {};
const listeners = new Set();
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function readAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, 'readonly');
    const store = tx.objectStore(OBJECT_STORE);
    const result = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { result[cur.key] = cur.value; cur.continue(); } else resolve(result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function writeCollection(name, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, 'readwrite');
    tx.objectStore(OBJECT_STORE).put(value, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const pending = new Set();
let flushTimer = null;
function scheduleSave(name) {
  pending.add(name);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    const names = [...pending]; pending.clear();
    for (const n of names) {
      try { await writeCollection(n, JSON.parse(JSON.stringify(state[n]))); }
      catch (e) { console.error('Erreur de sauvegarde', n, e); }
    }
  }, 150);
}

function emit(col) { listeners.forEach(fn => { try { fn(col); } catch (e) { console.error(e); } }); }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  async init() {
    let saved = {};
    try { saved = await readAll(); } catch (e) { console.error('IndexedDB indisponible', e); }
    for (const c of COLLECTIONS) {
      if (c === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      else state[c] = Array.isArray(saved[c]) ? saved[c] : [];
    }
    return state;
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  settings() { return state.settings; },
  saveSettings(patch) { state.settings = { ...state.settings, ...patch }; scheduleSave('settings'); emit('settings'); },
  all(col) { return state[col]; },
  get(col, id) { return state[col].find(x => x.id === id) || null; },
  find(col, pred) { return state[col].filter(pred); },
  insert(col, obj) {
    const now = new Date().toISOString();
    const rec = { id: uid(), createdAt: now, updatedAt: now, ...obj };
    state[col].push(rec); scheduleSave(col); emit(col); return rec;
  },
  update(col, id, patch) {
    const i = state[col].findIndex(x => x.id === id);
    if (i < 0) return null;
    state[col][i] = { ...state[col][i], ...patch, updatedAt: new Date().toISOString() };
    scheduleSave(col); emit(col); return state[col][i];
  },
  remove(col, id) {
    const i = state[col].findIndex(x => x.id === id);
    if (i < 0) return false;
    state[col].splice(i, 1); scheduleSave(col); emit(col); return true;
  },
  exportJSON() {
    const data = { app: 'dermagen-erp', version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
    for (const c of COLLECTIONS) data.data[c] = state[c];
    return JSON.stringify(data, null, 2);
  },
  async importJSON(text) {
    const parsed = JSON.parse(text);
    const src = parsed.data || parsed;
    for (const c of COLLECTIONS) {
      if (c === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(src.settings || {}) };
      else state[c] = Array.isArray(src[c]) ? src[c] : [];
      await writeCollection(c, JSON.parse(JSON.stringify(state[c])));
    }
    emit('*');
  },
  async reset() {
    for (const c of COLLECTIONS) {
      state[c] = c === 'settings' ? { ...DEFAULT_SETTINGS } : [];
      await writeCollection(c, JSON.parse(JSON.stringify(state[c])));
    }
    emit('*');
  },
  // Numérotation séquentielle : PREFIX-AAAA-NNN
  nextNumber(col, field, prefix) {
    const year = new Date().getFullYear();
    const re = new RegExp('^' + prefix + '-' + year + '-(\d+)$');
    let max = 0;
    for (const r of state[col]) {
      const m = re.exec(r[field] || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
  }
};
