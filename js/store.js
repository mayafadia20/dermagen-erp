// Couche de persistance : état en mémoire, cache dans IndexedDB (navigateur) et, lorsque Supabase est
// configuré (js/config.js), base en ligne partagée par toute l'équipe avec synchronisation en temps réel.
// Chaque collection est un tableau d'objets avec un champ `id`.
import { cloud } from './cloud.js';

const DB_NAME = 'dermagen-erp';
const DB_VERSION = 1;
const OBJECT_STORE = 'collections';

export const COLLECTIONS = [
  'ingredients', 'movements', 'formulations', 'suppliers',
  'purchases', 'invoices', 'payments', 'passwords', 'accelerators', 'chats', 'users', 'recipes', 'settings'
];

export const DEFAULT_SETTINGS = {
  company: 'DermaGen',
  address: 'Montréal (Québec)',
  email: 'info@dermagen.ca',
  currency: 'CAD',
  tps: 5,
  tvq: 9.975,
  lowStockDays: 60,
  categories: ['Actif', 'Agent conditionneur', 'Tensioactif', 'Émollient', 'Huile', 'Beurre', 'Humectant', 'Épaississant', 'Conservateur', 'Parfum', 'Ajusteur de pH', 'Solvant', 'Emballage', 'Matériel de laboratoire', 'Autre'],
  productTypes: ['Shampoing', 'Revitalisant', 'Masque', 'Traitement lissant', 'Sérum', 'Huile capillaire', 'Poudre de soin', 'Capsule', 'Autre'],
  units: ['g', 'kg', 'ml', 'L', 'unité'],
  paymentMethods: ['Virement bancaire', 'Carte de crédit', 'Interac', 'Chèque', 'PayPal', 'Comptant'],
  paymentTerms: ['Paiement à la commande', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
  passwordCategories: ['Banque & finances', 'Gouvernement', 'Fournisseurs', 'Logiciels & abonnements', 'Réseaux sociaux', 'Site web & domaine', 'Courriel', 'Autre'],
  acceleratorTypes: ['Accélérateur', 'Incubateur', 'Subvention', 'Concours', 'Financement', 'Programme de mentorat', 'Autre'],
  anthropicKey: '',
  chatModel: 'claude-opus-5-5',
  chatEffort: 'medium',
  chatWeb: true
};

const state = {};
const listeners = new Set();
let dbPromise = null;

// ---------- Cache local (IndexedDB) ----------
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
    req.onsuccess = () => { const cur = req.result; if (cur) { result[cur.key] = cur.value; cur.continue(); } else resolve(result); };
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

// ---------- File d'attente vers la base en ligne ----------
const QUEUE_KEY = '__queue';
let queue = [];            // [{ op: 'upsert'|'delete', collection, id, data }]
let flushing = false, cloudReady = false, unsubscribe = null, lastCloudError = null;
const cloudListeners = new Set();
function notifyCloud() { cloudListeners.forEach(fn => { try { fn(db.cloudStatus()); } catch (e) { console.error(e); } }); }
async function persistQueue() { try { await writeCollection(QUEUE_KEY, JSON.parse(JSON.stringify(queue))); } catch (e) { console.error(e); } }
function enqueue(op) {
  if (!cloudReady) return;
  // Une opération plus récente sur le même document remplace la précédente
  queue = queue.filter(q => !(q.collection === op.collection && q.id === op.id));
  queue.push(op);
  persistQueue();
  flushQueue();
}
async function flushQueue() {
  if (flushing || !cloudReady || !queue.length) return;
  flushing = true;
  try {
    while (queue.length) {
      const batchUp = queue.filter(q => q.op === 'upsert').slice(0, 50);
      const del = queue.find(q => q.op === 'delete');
      if (batchUp.length) { await cloud.upsert(batchUp.map(q => ({ collection: q.collection, id: q.id, data: q.data }))); queue = queue.filter(q => !batchUp.includes(q)); }
      else if (del) { await cloud.remove(del.collection, del.id); queue = queue.filter(q => q !== del); }
      await persistQueue();
    }
    lastCloudError = null;
  } catch (e) {
    console.warn('Synchronisation en attente :', e.message);
    lastCloudError = e.message;
    setTimeout(flushQueue, 15000);
  } finally { flushing = false; notifyCloud(); }
}
if (typeof addEventListener === 'function') addEventListener('online', () => flushQueue());

function emit(col) { listeners.forEach(fn => { try { fn(col); } catch (e) { console.error(e); } }); }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function applyRemote(change) {
  const { collection, id, data } = change;
  if (!COLLECTIONS.includes(collection)) return;
  if (collection === 'settings') { if (data) { state.settings = { ...DEFAULT_SETTINGS, ...data }; scheduleSave('settings'); emit('settings'); } return; }
  const arr = state[collection];
  const i = arr.findIndex(x => x.id === id);
  if (change.type === 'delete') { if (i >= 0) { arr.splice(i, 1); scheduleSave(collection); emit(collection); } return; }
  if (!data) return;
  if (i >= 0) { if ((arr[i].updatedAt || '') >= (data.updatedAt || '') && JSON.stringify(arr[i]) === JSON.stringify(data)) return; arr[i] = data; }
  else arr.push(data);
  scheduleSave(collection); emit(collection);
}

export const db = {
  async init() {
    let saved = {};
    try { saved = await readAll(); } catch (e) { console.error('IndexedDB indisponible', e); }
    for (const c of COLLECTIONS) {
      if (c === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      else state[c] = Array.isArray(saved[c]) ? saved[c] : [];
    }
    queue = Array.isArray(saved[QUEUE_KEY]) ? saved[QUEUE_KEY] : [];
    return state;
  },
  /** Après connexion : charge la base en ligne (elle fait foi), envoie ce qui attendait, et s'abonne au temps réel. */
  async sync() {
    if (!cloud.enabled()) return false;
    const remote = await cloud.loadAll();
    const remoteEmpty = !Object.keys(remote).length;
    for (const c of COLLECTIONS) {
      if (c === 'settings') {
        const r = (remote.settings || [])[0];
        if (r) state.settings = { ...DEFAULT_SETTINGS, ...r };
      } else if (remote[c] || !remoteEmpty) state[c] = remote[c] || [];
      scheduleSave(c);
    }
    cloudReady = true;
    // Première mise en ligne : les données déjà présentes dans ce navigateur sont envoyées
    if (remoteEmpty) {
      const rows = [];
      for (const c of COLLECTIONS) { if (c === 'settings') rows.push({ collection: 'settings', id: 'settings', data: state.settings }); else for (const rec of state[c]) rows.push({ collection: c, id: rec.id, data: rec }); }
      queue = [...queue.filter(q => !rows.some(r => r.collection === q.collection && r.id === q.id)), ...rows.map(r => ({ op: 'upsert', ...r }))];
      await persistQueue();
    }
    await flushQueue();
    if (!unsubscribe) unsubscribe = await cloud.subscribe(applyRemote);
    emit('*');
    notifyCloud();
    return true;
  },
  cloudStatus() { return { enabled: cloud.enabled(), ready: cloudReady, pending: queue.length, error: lastCloudError, region: cloud.region() }; },
  onCloud(fn) { cloudListeners.add(fn); return () => cloudListeners.delete(fn); },
  async flush() { await flushQueue(); },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  settings() { return state.settings; },
  saveSettings(patch) { state.settings = { ...state.settings, ...patch }; scheduleSave('settings'); enqueue({ op: 'upsert', collection: 'settings', id: 'settings', data: state.settings }); emit('settings'); },
  all(col) { return state[col]; },
  get(col, id) { return state[col].find(x => x.id === id) || null; },
  find(col, pred) { return state[col].filter(pred); },
  insert(col, obj) {
    const now = new Date().toISOString();
    const rec = { id: uid(), createdAt: now, updatedAt: now, ...obj };
    state[col].push(rec); scheduleSave(col); enqueue({ op: 'upsert', collection: col, id: rec.id, data: rec }); emit(col); return rec;
  },
  update(col, id, patch) {
    const i = state[col].findIndex(x => x.id === id);
    if (i < 0) return null;
    state[col][i] = { ...state[col][i], ...patch, updatedAt: new Date().toISOString() };
    scheduleSave(col); enqueue({ op: 'upsert', collection: col, id, data: state[col][i] }); emit(col); return state[col][i];
  },
  remove(col, id) {
    const i = state[col].findIndex(x => x.id === id);
    if (i < 0) return false;
    state[col].splice(i, 1); scheduleSave(col); enqueue({ op: 'delete', collection: col, id }); emit(col); return true;
  },
  exportJSON() {
    const data = { app: 'dermagen-erp', version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
    for (const c of COLLECTIONS) data.data[c] = state[c];
    return JSON.stringify(data, null, 2);
  },
  async importJSON(text) {
    const parsed = JSON.parse(text);
    const src = parsed.data || parsed;
    const rows = [];
    for (const c of COLLECTIONS) {
      if (c === 'settings') { state.settings = { ...DEFAULT_SETTINGS, ...(src.settings || {}) }; rows.push({ op: 'upsert', collection: 'settings', id: 'settings', data: state.settings }); }
      else { state[c] = Array.isArray(src[c]) ? src[c] : []; for (const rec of state[c]) rows.push({ op: 'upsert', collection: c, id: rec.id, data: rec }); }
      await writeCollection(c, JSON.parse(JSON.stringify(state[c])));
    }
    if (cloudReady) { queue = [...queue, ...rows]; await persistQueue(); await flushQueue(); }
    emit('*');
  },
  async reset() {
    if (cloudReady) { queue = []; await persistQueue(); await cloud.removeAll(); }
    for (const c of COLLECTIONS) {
      state[c] = c === 'settings' ? { ...DEFAULT_SETTINGS } : [];
      await writeCollection(c, JSON.parse(JSON.stringify(state[c])));
    }
    emit('*');
  },
  // Numérotation séquentielle : PREFIX-AAAA-NNN
  nextNumber(col, field, prefix) {
    const year = new Date().getFullYear();
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    let max = 0;
    for (const r of state[col]) {
      const m = re.exec(r[field] || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
  }
};
