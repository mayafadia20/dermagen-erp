// Essais de formulation consignés dans le document « Calcul et quantités » (octobre 2026).
// Import en un clic depuis la page Formulations : crée les ingrédients manquants
// (reconnus par nom ou INCI s'ils existent déjà) puis les formulations, sans doublon.
import { db } from './store.js';
import { today, isoWeek, toast, confirmDialog } from './ui.js';
import { syncTrialBatches } from './inventaire.js';

// Catalogue des ingrédients cités, avec les noms sous lesquels ils peuvent déjà exister dans l'inventaire.
const INGREDIENTS = {
  eau:        { name: 'Eau purifiée',               inci: 'Aqua',                      category: 'Solvant',            role: 'Solvant',                 aliases: ['eau', 'eau déminéralisée', 'eau distillée', 'water', 'aqua'] },
  glycerine:  { name: 'Glycérine',                  inci: 'Glycerin',                  category: 'Humectant',          role: 'Humectant',               aliases: ['glycérine végétale', 'glycerin', 'glycerine'] },
  hec:        { name: 'Hydroxyethylcellulose',      inci: 'Hydroxyethylcellulose',     category: 'Épaississant',       role: 'Gélifiant / épaississant', aliases: ['hec'] },
  edta:       { name: 'EDTA disodique',             inci: 'Disodium EDTA',             category: 'Autre',              role: 'Chélatant',               aliases: ['disodium edta', 'edta'] },
  glycolique: { name: 'Acide glycolique',           inci: 'Glycolic Acid',             category: 'Actif',              role: 'Actif exfoliant (AHA)',   aliases: ['glycolic acid'] },
  citrique:   { name: 'Acide citrique',             inci: 'Citric Acid',               category: 'Ajusteur de pH',     role: 'Ajusteur de pH',          aliases: ['citric acid'] },
  panthenol:  { name: 'Panthénol',                  inci: 'Panthenol',                 category: 'Actif',              role: 'Hydratant / fortifiant',  aliases: ['d-panthénol', 'd-panthenol', 'panthenol', 'provitamine b5'] },
  caprylyl:   { name: 'Caprylyl glycol',            inci: 'Caprylyl Glycol',           category: 'Conservateur',       role: 'Conservateur / humectant', aliases: ['caprylyl glycol'] },
  phenoxy:    { name: 'Phénoxyéthanol',             inci: 'Phenoxyethanol',            category: 'Conservateur',       role: 'Conservateur',            aliases: ['phenoxyethanol', 'phénoxyethanol'] },
  pca:        { name: 'Sodium PCA',                 inci: 'Sodium PCA',                category: 'Humectant',          role: 'Humectant (NMF)',         aliases: ['sodium pca'] },
  citrate:    { name: 'Sodium citrate',             inci: 'Sodium Citrate',            category: 'Ajusteur de pH',     role: 'Tampon de pH',            aliases: ['citrate de sodium', 'sodium citrate'] },
  cococapr:   { name: 'Coco-Caprylate/Caprate',     inci: 'Coco-Caprylate/Caprate',    category: 'Émollient',          role: 'Émollient léger',         aliases: ['coco caprylate caprate', 'coco-caprylate'] },
  btms:       { name: 'BTMS-50',                    inci: 'Behentrimonium Methosulfate (and) Cetyl Alcohol (and) Butylene Glycol', category: 'Agent conditionneur', role: 'Émulsifiant conditionneur', aliases: ['btms 50', 'btms-50', 'btms'] },
  cetearyl:   { name: 'Alcool cétéarylique',        inci: 'Cetearyl Alcohol',          category: 'Épaississant',       role: 'Épaississant / co-émulsifiant', aliases: ['cetearyl alcohol', 'alcool cetearylique'] },
  keratinase: { name: 'Kératinase',                 inci: 'Keratinase',                category: 'Actif',              role: 'Enzyme (à confirmer *)',  aliases: ['keratinase'] },
  ble:        { name: 'Protéine de blé hydrolysée', inci: 'Hydrolyzed Wheat Protein',  category: 'Actif',              role: 'Protéine fortifiante',    aliases: ['wheat protein hydrolysed', 'hydrolyzed wheat protein', 'protéine de blé'] },
  keratine:   { name: 'Kératine hydrolysée',        inci: 'Hydrolyzed Keratin',        category: 'Actif',              role: 'Protéine réparatrice',    aliases: ['keratin protein', 'keratin', 'kératine'] },
  ah:         { name: 'Acide hyaluronique',         inci: 'Sodium Hyaluronate',        category: 'Actif',              role: 'Hydratant filmogène',     aliases: ['hyaluronic acid', 'sodium hyaluronate', 'acide hyaluronique'] },
};

// Chaque ligne : [clé ingrédient, phase, % (ou quantité en g pour le lot indiqué), fonction facultative]
const ESSAIS = [
  {
    key: 'booster-activation', name: 'Booster Activation / Préparateur', version: 1, status: 'En développement', batchSize: 109.5, quantities: true,
    objective: 'Prototype du préparateur : formule exprimée en quantités pour 100 g d’eau (lot de 109,5 g). L’acide glycolique est marqué « * » dans le document (à confirmer).',
    lines: [['eau', 'A', 100], ['glycerine', 'A', 3], ['hec', 'A', 0.5], ['edta', 'A', 0.1], ['glycolique', 'B', 3, 'Actif exfoliant (AHA) *'], ['citrique', 'B', 0.5], ['panthenol', 'B', 1], ['caprylyl', 'C', 0.5], ['phenoxy', 'C', 0.9]],
    notes: 'Document « Calcul et quantités » — tableau « Booster Activation / Préparateur — prototype ». Les pourcentages affichés sont recalculés sur le lot total de 109,5 g.'
  },
  {
    key: 'phase-t1', name: 'Phase Transformante', version: 1, status: 'En développement', batchSize: 100,
    objective: 'Premier prototype de 100 g.',
    lines: [['eau', 'A', 84.1, 'Solvant (qsp 100)'], ['glycerine', 'A', 3], ['pca', 'A', 1.5], ['hec', 'A', 0.5], ['citrate', 'A', 0.3], ['edta', 'A', 0.1], ['cococapr', 'B', 3], ['btms', 'B', 4], ['panthenol', 'C', 1], ['phenoxy', 'C', 0.9], ['caprylyl', 'C', 0.5], ['keratinase', 'C', 0.5, 'Enzyme (à confirmer *)']],
    notes: 'Document « Calcul et quantités » — Phase T 1. Le document indique 84,10 g d’eau, ce qui porte le total à 99,4 g ; « qsp 100 » donnerait 84,7 g.'
  },
  {
    key: 'phase-t2', name: 'Phase Transformante', version: 2, status: 'En développement', batchSize: 100,
    objective: 'Prototype plus dense (100 g) : HEC à 0,8 %, émollient et BTMS-50 augmentés, ajout d’alcool cétéarylique.',
    lines: [['eau', 'A', 80.5, 'Solvant (qsp 100)'], ['glycerine', 'A', 3], ['pca', 'A', 1.5], ['hec', 'A', 0.8], ['citrate', 'A', 0.3], ['edta', 'A', 0.1], ['cococapr', 'B', 4], ['btms', 'B', 4.5], ['cetearyl', 'B', 2.5], ['panthenol', 'C', 1], ['phenoxy', 'C', 0.9], ['caprylyl', 'C', 0.5], ['keratinase', 'C', 0.5, 'Enzyme (à confirmer *)']],
    notes: 'Document « Calcul et quantités » — Phase T2.'
  },
  {
    key: 'phase-t3', name: 'Phase Transformante', version: 3, status: 'En développement', batchSize: 100,
    objective: 'Prototype intermédiaire (100 g) entre T1 et T2 : HEC 0,6 %, émollient et BTMS-50 à 3,5 %, alcool cétéarylique 1,5 %.',
    lines: [['eau', 'A', 82.9, 'Solvant (qsp 100)'], ['glycerine', 'A', 3], ['pca', 'A', 1.5], ['hec', 'A', 0.6], ['citrate', 'A', 0.3], ['edta', 'A', 0.1], ['cococapr', 'B', 3.5], ['btms', 'B', 3.5], ['cetearyl', 'B', 1.5], ['panthenol', 'C', 1], ['phenoxy', 'C', 0.9], ['caprylyl', 'C', 0.5], ['keratinase', 'C', 0.5, 'Enzyme (à confirmer *)']],
    notes: 'Document « Calcul et quantités » — Phase T 3 (le tableau se poursuit en haut de la page 3).'
  },
  {
    key: 'booster-lipidique', name: 'Booster lipidique', version: 1, status: 'En développement', batchSize: 100,
    objective: 'Soin lipidique : même phase huileuse que la Phase Transformante dense (T2), actifs protéiques et acide hyaluronique à la place de la kératinase.',
    lines: [['eau', 'A', 80.5, 'Solvant (qsp 100)'], ['glycerine', 'A', 3], ['hec', 'A', 0.8], ['edta', 'A', 0.1], ['cococapr', 'B', 4], ['btms', 'B', 4.5], ['cetearyl', 'B', 2.5], ['panthenol', 'C', 1], ['phenoxy', 'C', 0.9], ['caprylyl', 'C', 0.5], ['ble', 'C', 2], ['keratine', 'C', 2], ['ah', 'C', 0.5]],
    notes: 'Document « Calcul et quantités » — Booster lipidique. « On garde les mêmes pourcentages pour la phase huileuse, le reste selon les ingrédients du soin lipidique. » Les quantités du document totalisent 102,3 g : l’eau « qsp 100 » devrait être ramenée à 78,2 g.'
  },
  {
    key: 'phase-t4', name: 'Phase Transformante', version: 4, status: 'En test', batchSize: 100,
    objective: 'Essai 4 — prototype plus dense (100 g) : émollient 3,5 %, BTMS-50 3 %, alcool cétéarylique 1 %.',
    lines: [['eau', 'A', 84, 'Solvant (qsp 100)'], ['glycerine', 'A', 3], ['pca', 'A', 1.5], ['hec', 'A', 0.8], ['citrate', 'A', 0.3], ['edta', 'A', 0.1], ['cococapr', 'B', 3.5], ['btms', 'B', 3], ['cetearyl', 'B', 1], ['panthenol', 'C', 1], ['phenoxy', 'C', 0.9], ['caprylyl', 'C', 0.5], ['keratinase', 'C', 0.5, 'Enzyme (à confirmer *)']],
    viscosity: 'Texture désirée atteinte',
    stability: 'À confirmer',
    result: 'Ça aboutit à la texture désirée, mais reste à confirmer si l’émulsion est stable.',
    notes: 'Document « Calcul et quantités » — Phase T essai 4.'
  },
];

const PROCEDURE = 'Phase A (aqueuse) : disperser l’hydroxyethylcellulose dans l’eau, ajouter glycérine, Sodium PCA, citrate et EDTA, chauffer à 70–75 °C.\nPhase B (grasse) : fondre BTMS-50, alcool cétéarylique et Coco-Caprylate/Caprate à 70–75 °C, verser dans A sous agitation.\nPhase C (< 40 °C) : ajouter panthénol, conservateurs et actifs. Ajuster le pH.';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function nextIngredientCode() {
  const codes = db.all('ingredients').map(i => /^ING-(\d+)$/.exec(i.code || '')).filter(Boolean).map(m => +m[1]);
  return 'ING-' + String((codes.length ? Math.max(...codes) : 0) + 1).padStart(3, '0');
}

// Retrouve un ingrédient existant par nom, INCI ou alias ; sinon le crée (stock 0, coût 0).
function resolveIngredient(def) {
  const wanted = new Set([def.name, def.inci, ...def.aliases].map(norm));
  const found = db.all('ingredients').find(i => wanted.has(norm(i.name)) || wanted.has(norm(i.inci)));
  if (found) return { ing: found, created: false };
  const ing = db.insert('ingredients', { code: nextIngredientCode(), name: def.name, inci: def.inci, category: def.category, role: def.role, unit: 'g', stock: 0, minStock: 0, cost: 0, notes: 'Créé lors de l’import des essais de formulation (octobre 2026).' });
  return { ing, created: true };
}

export const ESSAIS_TAG = 'essais-2026-10';

export async function importEssais(navigate) {
  const already = db.all('formulations').filter(f => f.importTag === ESSAIS_TAG).map(f => f.importKey);
  const todo = ESSAIS.filter(e => !already.includes(e.key));
  if (!todo.length) { toast('Les essais du document sont déjà importés.', 'warn'); return; }
  if (!await confirmDialog(`Importer ${todo.length} formulation(s) du document « Calcul et quantités » ? Les ingrédients absents de l’inventaire seront créés (stock et coût à 0).`, { danger: false, label: 'Importer' })) return;

  const date = today(), week = isoWeek(date);
  const prefix = `F-${week.year}-S${String(week.week).padStart(2, '0')}-`;
  let seq = db.all('formulations').filter(f => (f.code || '').startsWith(prefix)).length;
  const created = new Set();
  const codes = {};
  for (const e of ESSAIS) {
    if (!todo.includes(e)) { codes[e.key] = db.all('formulations').find(f => f.importKey === e.key)?.code; continue; }
    const divisor = e.quantities ? e.lines.reduce((t, l) => t + l[2], 0) : 100;
    const lines = e.lines.map(([k, phase, q, role]) => {
      const def = INGREDIENTS[k];
      const r = resolveIngredient(def); if (r.created) created.add(def.name);
      return { phase, ingredientId: r.ing.id, pct: Math.round(q / divisor * 100 * 1000) / 1000, role: role || def.role };
    });
    seq += 1;
    const code = prefix + String(seq).padStart(2, '0');
    codes[e.key] = code;
    const parentKey = e.version > 1 ? e.key.replace(/\d+$/, String(e.version - 1)) : '';
    db.insert('formulations', {
      code, name: e.name, version: e.version, parentCode: parentKey ? codes[parentKey] || '' : '', date, weekKey: week.key,
      productType: 'Traitement lissant', status: e.status, batchSize: e.batchSize, author: 'DermaGen',
      objective: e.objective, lines, procedure: PROCEDURE, ph: '', viscosity: e.viscosity || '', aspect: '', stability: e.stability || '',
      result: e.result || '', notes: e.notes, importTag: ESSAIS_TAG, importKey: e.key
    });
  }
  const t = syncTrialBatches();
  toast(`${todo.length} formulation(s) importée(s)` + (created.size ? ` · ${created.size} ingrédient(s) créé(s)` : '') + (t.n ? ` · ${t.n} essai(s) déduit(s) du stock` : ''));
  navigate && navigate('formulations');
}
