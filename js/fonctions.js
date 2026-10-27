// Fonction des ingrédients dans une formule, remplie automatiquement :
//  1) depuis l'inventaire (champ « rôle » de l'ingrédient) quand il est connu ;
//  2) sinon par l'assistante chimiste (API Claude), puis mémorisée sur l'ingrédient pour la prochaine fois.
import { db } from './store.js';
import { ask, apiConfig } from './chimiste.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const cache = new Map();   // nom normalisé → fonction (pour la session)

export const aiAvailable = () => !!apiConfig().key;

/** Fonction déjà connue pour un ingrédient (inventaire ou session), sans appel réseau. */
export function knownRole({ id, name, inci } = {}) {
  const ing = id ? db.get('ingredients', id) : null;
  if (ing?.role) return ing.role;
  for (const k of [name, inci]) { const v = k && cache.get(norm(k)); if (v) return v; }
  if (!ing) {
    const found = db.all('ingredients').find(i => (name && norm(i.name) === norm(name)) || (inci && i.inci && norm(i.inci) === norm(inci)));
    if (found?.role) return found.role;
  }
  return '';
}

/**
 * Demande à l'assistante la fonction de chaque ingrédient (2 à 6 mots). items : [{ name, inci, id? }].
 * Retourne { [nom normalisé]: fonction } ; mémorise sur l'ingrédient de l'inventaire quand il existe.
 */
export async function suggestRoles(items, { signal } = {}) {
  const todo = items.filter(i => i.name && !knownRole(i));
  if (!todo.length || !aiAvailable()) return {};
  const prompt = `Pour chaque ingrédient cosmétique ci-dessous, donne sa fonction principale dans une formule de soin capillaire, en 2 à 6 mots en français (exemples : « Humectant », « Conservateur », « Émollient · protection de surface », « Gélifiant · texture »). Réponds uniquement par un objet JSON dont les clés sont les noms exactement tels qu'écrits ci-dessous et les valeurs la fonction, sans aucun autre texte.\n${todo.map(i => `- ${i.name}${i.inci ? ` (INCI : ${i.inci})` : ''}`).join('\n')}`;
  const { text } = await ask({ history: [{ role: 'user', content: prompt }], web: false, tools: false, signal });
  const m = /\{[\s\S]*\}/.exec(text || '');
  let parsed = {};
  try { parsed = m ? JSON.parse(m[0]) : {}; } catch (_) { parsed = {}; }
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const role = String(v || '').trim().slice(0, 80); if (!role) continue;
    const key = norm(k); out[key] = role; cache.set(key, role);
    const it = todo.find(i => norm(i.name) === key || (i.inci && norm(i.inci) === key));
    if (it) {
      if (it.inci) cache.set(norm(it.inci), role);
      const ing = it.id ? db.get('ingredients', it.id) : db.all('ingredients').find(i => norm(i.name) === norm(it.name));
      if (ing && !ing.role) db.update('ingredients', ing.id, { role });
    }
  }
  return out;
}

/**
 * Remplit les champs « Fonction » vides d'un éditeur de lignes.
 * rows() → [{ input: HTMLInputElement, name, inci, id }] ; les fonctions connues sont posées tout de suite,
 * les autres après la réponse de l'assistante (le champ n'est écrasé que s'il est encore vide).
 */
export function makeRoleFiller(rows, { delay = 900 } = {}) {
  let timer = null, pending = null;
  const fillKnown = () => {
    const rest = [];
    for (const r of rows()) {
      if (!r.input || r.input.value.trim() || !r.name) continue;
      const k = knownRole(r); if (k) r.input.value = k; else rest.push(r);
    }
    return rest;
  };
  const run = async () => {
    const rest = fillKnown();
    if (!rest.length || !aiAvailable()) return;
    rest.forEach(r => { r.input.placeholder = 'Fonction… (assistante en cours)'; r.input.classList.add('ai-pending'); });
    try {
      const roles = await suggestRoles(rest.map(r => ({ name: r.name, inci: r.inci, id: r.id })));
      for (const r of rest) { const v = roles[norm(r.name)] || (r.inci && roles[norm(r.inci)]); if (v && r.input.isConnected && !r.input.value.trim()) r.input.value = v; }
    } catch (e) { console.warn('Fonctions par l’assistante :', e.message); }
    finally { rest.forEach(r => { r.input.placeholder = 'Fonction'; r.input.classList.remove('ai-pending'); }); }
  };
  return {
    schedule() { clearTimeout(timer); timer = setTimeout(() => { pending = run(); }, delay); },
    now() { clearTimeout(timer); pending = run(); return pending; },
    fillKnown,
  };
}
