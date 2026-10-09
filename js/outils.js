// Outils que l'assistante peut appeler depuis une discussion : créer une formulation réelle,
// définir les étapes d'un mode opératoire, enregistrer observations et résultats.
// Chaque outil est validé ici avant exécution ; l'assistante ne touche jamais directement à la base.
import { db } from './store.js';
import { today, isoWeek, num } from './ui.js';
import { currentUser } from './auth.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export const TOOL_DEFS = [
  {
    name: 'creer_formulation',
    description: 'Crée une formulation réelle dans l’ERP (essai de laboratoire) avec sa composition, à partir des ingrédients et quantités que la formulatrice a demandés. Les ingrédients sont retrouvés dans l’inventaire par leur nom ou leur INCI ; un ingrédient absent est créé à stock 0. Donne soit le pourcentage, soit la quantité en grammes de chaque ligne (la taille du lot sert à convertir). Si l’eau doit compléter à 100 %, indique-la avec qsp = true. N’appelle cet outil que lorsque la demande de création est explicite et que la composition est claire ; sinon, pose d’abord tes questions.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom de la formulation' },
        recipeId: { type: 'string', description: 'Identifiant de la fiche théorique à rattacher (vide si aucune)' },
        batchSize: { type: 'number', description: 'Taille du lot de référence en grammes (défaut 100)' },
        objective: { type: 'string', description: 'Objectif ou hypothèse de l’essai' },
        status: { type: 'string', enum: ['En développement', 'En test', 'Validée', 'Abandonnée'] },
        lines: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: {
              ingredient: { type: 'string', description: 'Nom ou INCI de l’ingrédient' },
              pct: { type: 'number', description: 'Pourcentage de la formule' },
              grams: { type: 'number', description: 'Quantité en grammes pour le lot' },
              qsp: { type: 'boolean', description: 'Vrai si cet ingrédient complète la formule à 100 % (généralement l’eau)' },
              phase: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'], description: 'A aqueuse, B grasse, C froide (actifs, conservateurs)' },
              role: { type: 'string', description: 'Fonction de l’ingrédient dans la formule' },
            },
            required: ['ingredient'],
          },
        },
        steps: { type: 'array', items: { type: 'string' }, description: 'Étapes du mode opératoire, dans l’ordre' },
      },
      required: ['name', 'lines'],
    },
  },
  {
    name: 'definir_etapes',
    description: 'Remplace ou complète les étapes du mode opératoire d’une fiche théorique ou d’une formulation réelle, à partir de la description de la formulatrice. Rédige des étapes courtes, une action par étape, dans l’ordre de fabrication.',
    input_schema: {
      type: 'object',
      properties: {
        cible: { type: 'string', enum: ['fiche', 'formulation'], description: 'Où écrire les étapes' },
        id: { type: 'string', description: 'Identifiant de la fiche théorique (cible fiche) ; vide = fiche en cours' },
        code: { type: 'string', description: 'Code de la formulation réelle (cible formulation), ex. F-2026-S41-03 ; vide = formulation en cours' },
        mode: { type: 'string', enum: ['remplacer', 'ajouter'], description: 'Remplacer toutes les étapes ou ajouter à la fin (défaut remplacer)' },
        steps: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['cible', 'steps'],
    },
  },
  {
    name: 'enregistrer_observations',
    description: 'Enregistre sur une formulation réelle les observations et résultats rapportés dans la conversation (pH, viscosité ou texture, aspect ou odeur, stabilité, résultats des tests, commentaires pour la prochaine fois, statut). Ne renseigne que ce que la formulatrice a réellement dit ; laisse vide le reste. Les champs texte remplacent la valeur existante.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code de la formulation réelle, ex. F-2026-S41-03 ; vide = formulation en cours' },
        ph: { type: 'string' }, viscosity: { type: 'string' }, aspect: { type: 'string' }, stability: { type: 'string' },
        result: { type: 'string', description: 'Résultats des tests' },
        notes: { type: 'string', description: 'Commentaires pour la prochaine fois' },
        status: { type: 'string', enum: ['En développement', 'En test', 'Validée', 'Abandonnée'] },
      },
      required: [],
    },
  },
];

export const TOOLS_NOTE = `Tu disposes d’outils pour agir dans l’ERP : creer_formulation (créer une formulation réelle avec sa composition), definir_etapes (écrire les étapes d’un mode opératoire sur une fiche ou une formulation) et enregistrer_observations (consigner pH, viscosité, aspect, stabilité, résultats, commentaires pour la prochaine fois et statut sur une formulation). Utilise-les quand la formulatrice te demande de créer, d’écrire ou d’enregistrer quelque chose, ou quand elle rapporte des observations sur un essai et accepte qu’on les consigne. Avant de créer une formulation, assure-toi que les ingrédients et les quantités sont clairs ; sinon demande. Après un appel d’outil, confirme en une ou deux phrases ce qui a été fait, avec le code de la formulation. N’invente jamais une observation : n’enregistre que ce qui a été dit.`;

// ---------- Exécution ----------
function findIngredient(text) {
  const w = norm(text); if (!w) return null;
  const all = db.all('ingredients').filter(i => i.category !== 'Matériel de laboratoire');
  return all.find(i => norm(i.name) === w || norm(i.inci) === w)
    || all.find(i => norm(i.name).includes(w) || w.includes(norm(i.name)) || (i.inci && (norm(i.inci).includes(w) || w.includes(norm(i.inci)))))
    || null;
}
function nextIngredientCode() {
  const codes = db.all('ingredients').map(i => /^ING-(\d+)$/.exec(i.code || '')).filter(Boolean).map(m => +m[1]);
  return 'ING-' + String((codes.length ? Math.max(...codes) : 0) + 1).padStart(3, '0');
}
function nextFormCode(date) {
  const w = isoWeek(date); const prefix = `F-${w.year}-S${String(w.week).padStart(2, '0')}-`;
  return prefix + String(db.all('formulations').filter(f => (f.code || '').startsWith(prefix)).length + 1).padStart(2, '0');
}
const findFormulation = (code, fallbackId) => {
  if (code) { const c = norm(code); const f = db.all('formulations').find(x => norm(x.code) === c); if (f) return f; }
  return fallbackId ? db.get('formulations', fallbackId) : null;
};
const cleanSteps = (steps) => (Array.isArray(steps) ? steps : []).map(s => String(s).trim()).filter(Boolean);

/**
 * Exécute un outil. ctx = { recipeId, formulationId } (éléments en cours dans l'interface).
 * Retourne { ok, message, link?, data? } ; message est renvoyé à l'assistante.
 */
export function runTool(name, input, ctx = {}) {
  try {
    if (name === 'creer_formulation') return creerFormulation(input, ctx);
    if (name === 'definir_etapes') return definirEtapes(input, ctx);
    if (name === 'enregistrer_observations') return enregistrerObservations(input, ctx);
    return { ok: false, message: `Outil inconnu : ${name}` };
  } catch (e) { return { ok: false, message: e.message || 'Erreur' }; }
}

function creerFormulation(input, ctx) {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) throw new Error('Le nom de la formulation est obligatoire.');
  if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Au moins une ligne de composition est requise.');
  const batch = Number(input.batchSize) > 0 ? Number(input.batchSize) : 100;
  const created = [];
  const lines = []; let qspIdx = -1;
  input.lines.forEach((l, idx) => {
    if (!l || typeof l.ingredient !== 'string') throw new Error(`Ligne ${idx + 1} : ingrédient manquant.`);
    let ing = findIngredient(l.ingredient);
    if (!ing) { ing = db.insert('ingredients', { code: nextIngredientCode(), name: l.ingredient.trim(), inci: '', category: 'Autre', unit: 'g', stock: 0, minStock: 0, cost: 0, location: 'Laboratoire', notes: 'Créé par l’assistante lors d’une formulation (à compléter : INCI, fournisseur, stock).' }); created.push(ing.name); }
    let pct = Number(l.pct);
    if (!(pct >= 0) && Number(l.grams) >= 0) pct = Number(l.grams) / batch * 100;
    if (l.qsp) { qspIdx = lines.length; pct = 0; }
    if (!(pct >= 0)) throw new Error(`Ligne ${idx + 1} (${l.ingredient}) : indique un pourcentage ou une quantité en grammes.`);
    lines.push({ phase: ['A', 'B', 'C', 'D', 'E'].includes(l.phase) ? l.phase : 'A', ingredientId: ing.id, pct: Math.round(pct * 1000) / 1000, role: String(l.role || '').trim() });
  });
  if (qspIdx >= 0) lines[qspIdx].pct = Math.round((100 - lines.reduce((t, l, i) => i === qspIdx ? t : t + l.pct, 0)) * 1000) / 1000;
  const total = lines.reduce((t, l) => t + l.pct, 0);
  const recipeId = input.recipeId && db.get('recipes', input.recipeId) ? input.recipeId : (ctx.recipeId && db.get('recipes', ctx.recipeId) ? ctx.recipeId : '');
  const date = today();
  const steps = cleanSteps(input.steps);
  const rec = db.insert('formulations', {
    code: nextFormCode(date), name: input.name.trim(), version: recipeId ? db.all('formulations').filter(x => x.recipeId === recipeId).length + 1 : 1,
    date, weekKey: isoWeek(date).key, productType: 'Traitement lissant', status: ['En développement', 'En test', 'Validée', 'Abandonnée'].includes(input.status) ? input.status : 'En développement',
    batchSize: batch, recipeId, author: currentUser()?.name || 'Assistante', objective: String(input.objective || '').trim(), lines, steps, procedure: steps.join('\n'),
    ph: '', viscosity: '', aspect: '', stability: '', result: '', notes: '', createdBy: 'assistante',
  });
  const summary = lines.map(l => `${db.get('ingredients', l.ingredientId).name} ${num(l.pct, 2)} %`).join(', ');
  return { ok: true, link: `#/formulations/${rec.id}`, data: { id: rec.id, code: rec.code },
    message: `Formulation ${rec.code} « ${rec.name} » créée (lot ${batch} g, total ${num(total, 2)} %${Math.abs(total - 100) > 0.01 ? ' — attention, pas 100 %' : ''}) : ${summary}.${created.length ? ` Ingrédients créés à stock 0 : ${created.join(', ')}.` : ''}${steps.length ? ` ${steps.length} étape(s) de mode opératoire enregistrée(s).` : ''}` };
}

function definirEtapes(input, ctx) {
  const steps = cleanSteps(input?.steps); if (!steps.length) throw new Error('Aucune étape fournie.');
  const mode = input.mode === 'ajouter' ? 'ajouter' : 'remplacer';
  if (input.cible === 'fiche') {
    const r = (input.id && db.get('recipes', input.id)) || (ctx.recipeId && db.get('recipes', ctx.recipeId));
    if (!r) throw new Error('Fiche théorique introuvable : précise laquelle.');
    const all = mode === 'ajouter' ? [...(r.steps || []), ...steps] : steps;
    db.update('recipes', r.id, { steps: all });
    return { ok: true, link: `#/formulations/fiche-${r.id}`, data: { steps: all }, message: `Mode opératoire de la fiche « ${r.name} » ${mode === 'ajouter' ? 'complété' : 'remplacé'} : ${all.length} étape(s).` };
  }
  const f = findFormulation(input.code, ctx.formulationId);
  if (!f) throw new Error('Formulation introuvable : donne son code (ex. F-2026-S41-03).');
  const all = mode === 'ajouter' ? [...(Array.isArray(f.steps) ? f.steps : []), ...steps] : steps;
  db.update('formulations', f.id, { steps: all, procedure: all.join('\n') });
  return { ok: true, link: `#/formulations/${f.id}`, data: { steps: all }, message: `Mode opératoire de ${f.code} ${mode === 'ajouter' ? 'complété' : 'remplacé'} : ${all.length} étape(s).` };
}

function enregistrerObservations(input, ctx) {
  const f = findFormulation(input?.code, ctx.formulationId);
  if (!f) throw new Error('Formulation introuvable : donne son code (ex. F-2026-S41-03).');
  const patch = {};
  for (const k of ['ph', 'viscosity', 'aspect', 'stability', 'result', 'notes']) if (typeof input[k] === 'string' && input[k].trim()) patch[k] = input[k].trim();
  if (['En développement', 'En test', 'Validée', 'Abandonnée'].includes(input.status)) patch.status = input.status;
  if (!Object.keys(patch).length) throw new Error('Aucune observation à enregistrer.');
  db.update('formulations', f.id, patch);
  const labels = { ph: 'pH', viscosity: 'viscosité', aspect: 'aspect', stability: 'stabilité', result: 'résultats', notes: 'commentaires pour la prochaine fois', status: 'statut' };
  return { ok: true, link: `#/formulations/${f.id}`, data: patch, message: `Observations enregistrées sur ${f.code} : ${Object.keys(patch).map(k => labels[k]).join(', ')}.` };
}
