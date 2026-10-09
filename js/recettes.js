// Fiches théoriques de la gamme DermaGen (cahier de charge v1.0 du 26 avril 2026).
// Chaque fiche est une formule de référence ; les formulations réelles (collection « formulations »)
// s'y rattachent par `recipeId`. Les fiches sont créées dans la base au premier passage, puis modifiables.
import { db } from './store.js';

export const RECIPES_TAG = 'cahier-2026-04-26';

// Ingrédients cités par le cahier de charge : nom affiché, INCI, catégorie, phase par défaut et alias de reconnaissance.
const ING = {
  eau:        { name: 'Eau purifiée', inci: 'Aqua', category: 'Solvant', phase: 'A', role: 'Véhicule (qsp 100)', aliases: ['eau', 'eau déminéralisée', 'water', 'aqua'] },
  keratinase: { name: 'Kératinase', inci: 'Protease', category: 'Actif', phase: 'C', role: 'Enzyme active — affaiblissement des liaisons kératiniques', aliases: ['keratinase'] },
  glycerine:  { name: 'Glycérine', inci: 'Glycerin', category: 'Humectant', phase: 'A', role: 'Humectant', aliases: ['glycérine végétale', 'glycerin', 'glycerine'] },
  pca:        { name: 'Sodium PCA', inci: 'Sodium PCA', category: 'Humectant', phase: 'A', role: 'Hydratant du cortex', aliases: ['sodium pca'] },
  hec:        { name: 'Hydroxyethylcellulose', inci: 'Hydroxyethylcellulose', category: 'Épaississant', phase: 'A', role: 'Gélifiant · texture', aliases: ['hec', 'hydroxyéthylcellulose'] },
  citrate:    { name: 'Sodium citrate', inci: 'Sodium Citrate', category: 'Ajusteur de pH', phase: 'A', role: 'Régulateur de pH (cible 5,0–6,0)', aliases: ['citrate de sodium', 'sodium citrate'] },
  cococapr:   { name: 'Coco-Caprylate/Caprate', inci: 'Coco-Caprylate/Caprate', category: 'Émollient', phase: 'B', role: 'Émollient · protection de surface', aliases: ['coco caprylate caprate', 'coco-caprylate'] },
  caprylyl:   { name: 'Caprylyl glycol', inci: 'Caprylyl Glycol', category: 'Conservateur', phase: 'C', role: 'Hydratant + conservateur', aliases: ['caprylyl glycol'] },
  panthenol:  { name: 'Panthénol', inci: 'Panthenol', category: 'Actif', phase: 'C', role: 'Provitamine B5 réparatrice', aliases: ['d-panthénol', 'd-panthenol', 'panthenol', 'd-panthénol (provitamine b5)', 'provitamine b5'] },
  edta:       { name: 'EDTA disodique', inci: 'Disodium EDTA', category: 'Autre', phase: 'A', role: 'Stabilisateur de l’activité enzymatique', aliases: ['edta', 'edta tétrasodique', 'tetrasodium edta', 'disodium edta'] },
  phenoxy:    { name: 'Phénoxyéthanol', inci: 'Phenoxyethanol', category: 'Conservateur', phase: 'C', role: 'Conservateur', aliases: ['phenoxyethanol'] },
  keratine:   { name: 'Kératine hydrolysée', inci: 'Hydrolyzed Keratin', category: 'Actif', phase: 'C', role: 'Comblement des zones lacunaires du cortex', aliases: ['keratin protein', 'hydrolyzed keratin', 'kératine'] },
  soie:       { name: 'Protéine de soie hydrolysée', inci: 'Hydrolyzed Silk', category: 'Actif', phase: 'C', role: 'Film protecteur sur la cuticule', aliases: ['protéines de soie', 'silk protein', 'hydrolyzed silk', 'protéine de soie'] },
  ble:        { name: 'Protéine de blé hydrolysée', inci: 'Hydrolyzed Wheat Protein', category: 'Actif', phase: 'C', role: 'Renforcement de la résistance mécanique de la fibre', aliases: ['protéines de blé', 'wheat protein', 'hydrolyzed wheat protein', 'protéine de blé'] },
  aloe:       { name: 'Gel d’aloe vera', inci: 'Aloe Barbadensis Leaf Juice', category: 'Actif', phase: 'A', role: 'Apaisement et tamponnement', aliases: ['aloe vera', 'aloe', 'aloe vera gel'] },
  argan:      { name: 'Huile d’argan', inci: 'Argania Spinosa Kernel Oil', category: 'Huile', phase: 'B', role: 'Protection lipidique de la surface du cheveu', aliases: ['huile d’argan bio', "huile d'argan", 'argan', 'argan oil'] },
  karite:     { name: 'Beurre de karité', inci: 'Butyrospermum Parkii Butter', category: 'Beurre', phase: 'B', role: 'Nutrition et protection mécanique de la cuticule', aliases: ['shea butter', 'karité'] },
  cetearyl:   { name: 'Alcool cétéarylique', inci: 'Cetearyl Alcohol', category: 'Épaississant', phase: 'B', role: 'Émulsifiant — dispersion dans le bol', aliases: ['cetearyl alcohol'] },
  aasoie:     { name: 'Acides aminés de soie', inci: 'Silk Amino Acids', category: 'Actif', phase: 'C', role: 'Film léger sur la cuticule · brillance', aliases: ['silk amino acids', 'silk amino acid'] },
  glycolique: { name: 'Acide glycolique', inci: 'Glycolic Acid', category: 'Actif', phase: 'C', role: 'Exfoliation légère de la cuticule · ouverture contrôlée', aliases: ['glycolic acid'] },
  citrique:   { name: 'Acide citrique', inci: 'Citric Acid', category: 'Ajusteur de pH', phase: 'C', role: 'Ajustement du pH', aliases: ['citric acid'] },
  peroxyde:   { name: 'Peroxyde d’hydrogène', inci: 'Hydrogen Peroxide', category: 'Actif', phase: 'C', role: 'Réoxydation des liaisons disulfures', aliases: ['hydrogen peroxide', 'eau oxygénée'] },
  ah:         { name: 'Acide hyaluronique', inci: 'Sodium Hyaluronate', category: 'Actif', phase: 'C', role: 'Réhydratation de la fibre', aliases: ['sodium hyaluronate', 'hyaluronic acid', 'sodium hyaluronique'] },
  riz:        { name: 'Protéines de riz hydrolysées', inci: 'Hydrolyzed Rice Protein', category: 'Actif', phase: 'C', role: 'Fixation de la structure · scellement de la cuticule', aliases: ['protéine de riz', 'rice protein', 'hydrolyzed rice protein'] },
  peg12:      { name: 'Silicone hydrosoluble (PEG-12 Dimethicone)', inci: 'PEG-12 Dimethicone', category: 'Agent conditionneur', phase: 'C', role: 'Fermeture uniforme de la cuticule · brillance · démêlage', aliases: ['peg-12 dimethicone', 'silicone hydrosoluble'] },
  jojoba:     { name: 'Huile de jojoba', inci: 'Simmondsia Chinensis (Jojoba) Seed Oil', category: 'Huile', phase: 'B', role: 'Film protecteur léger · souplesse', aliases: ['jojoba oil', 'jojoba', 'simmondsia chinensis seed oil'] },
};

const F1_BASE = (enz) => [['keratinase', enz], ['glycerine', 0.3], ['pca', 2], ['hec', 0.5], ['citrate', 0.3], ['cococapr', 3], ['caprylyl', 0.8], ['panthenol', 0.8], ['edta', 0.1], ['phenoxy', 0.8]];

// Lignes : [clé ingrédient, %] ; l'eau complète à 100 (qsp) et n'est pas listée.
export const RECIPES = [
  { key: 'f1-legere', bottle: 'Flacon 1', variant: 'R-Légère', name: 'F1 Soin Enzymatique Assouplissant — R-Légère', phase: 'T', order: 1, lines: F1_BASE(0.3),
    description: 'Flacon principal de la phase transformante. La kératinase affaiblit les liaisons kératiniques pour rendre la fibre malléable sans rupture permanente des ponts disulfures. Intensité légère : écart transformatif faible ou cheveux fragiles.',
    usage: 'Verser dans le bol avec les boosters indiqués par le diagnostic. Application avec source de chaleur douce 40–50 °C pendant 20–30 min. pH cible 5,0–6,0.',
    warning: 'Flacon opaque, airless : la kératinase se dégrade à la chaleur (> 55 °C) et à la lumière.' },
  { key: 'f1-moyenne', bottle: 'Flacon 1', variant: 'R-Moyenne', name: 'F1 Soin Enzymatique Assouplissant — R-Moyenne', phase: 'T', order: 2, lines: F1_BASE(0.5),
    description: 'Flacon principal de la phase transformante, intensité moyenne : écart transformatif modéré ou cheveux de diamètre moyen à épais.',
    usage: 'Verser dans le bol avec les boosters indiqués par le diagnostic. Application avec source de chaleur douce 40–50 °C pendant 20–30 min. pH cible 5,0–6,0.',
    warning: 'Flacon opaque, airless : la kératinase se dégrade à la chaleur (> 55 °C) et à la lumière.' },
  { key: 'f1-intense', bottle: 'Flacon 1', variant: 'R-Intense', name: 'F1 Soin Enzymatique Assouplissant — R-Intense', phase: 'T', order: 3, lines: F1_BASE(0.8),
    description: 'Flacon principal de la phase transformante, intensité forte : écart transformatif important ou cheveux épais et résistants, porosité faible à moyenne.',
    usage: 'Verser dans le bol avec les boosters indiqués par le diagnostic. Application avec source de chaleur douce 40–50 °C pendant 20–30 min. pH cible 5,0–6,0.',
    warning: 'Flacon opaque, airless : la kératinase se dégrade à la chaleur (> 55 °C) et à la lumière.' },
  { key: 'f2', bottle: 'Flacon 2', variant: 'Adjuvant', name: 'F2 Booster Protéique', phase: 'T', order: 4, lines: [['keratine', 12], ['soie', 5], ['ble', 5], ['panthenol', 3], ['aloe', 10]],
    description: 'Ajouté au Flacon 1 dans le bol pour les profils à haute porosité, cheveux colorés ou diamètre fin. Renforce la protection de la fibre pendant l’action chimique.',
    usage: 'Phase T, adjuvant. Mélanger au Flacon 1 dans le bol.', warning: 'Ne jamais mélanger avec le Flacon 4 (Booster Ouverture) : l’acide glycolique concentré dénature les protéines.' },
  { key: 'f3', bottle: 'Flacon 3', variant: 'Adjuvant', name: 'F3 Booster Lipidique', phase: 'T', order: 5, lines: [['argan', 20], ['karite', 10], ['cetearyl', 5], ['aasoie', 5]],
    description: 'Ajouté au bol pour les diamètres fins ou les cheveux à haute porosité. Crée un film protecteur sur la fibre pendant l’action du réducteur. Mélangeable dans le bol grâce à un émulsifiant intégré.',
    usage: 'Phase T, adjuvant. Mélanger au Flacon 1 dans le bol.', warning: '' },
  { key: 'f4', bottle: 'Flacon 4', variant: 'Porosité faible', name: 'F4 Booster Ouverture', phase: 'T', order: 6, lines: [['glycolique', 8], ['citrique', 2]],
    description: 'Utilisé exclusivement pour les cheveux à faible porosité. Aide à ouvrir temporairement la cuticule pour permettre la pénétration des agents restructurants.',
    usage: 'Phase T, porosité faible uniquement. pH cible 3,0–3,5.', warning: 'Ne jamais utiliser sur cheveux colorés ou à porosité élevée. Ne jamais mélanger avec le Flacon 2 (Booster Protéique).' },
  { key: 'f5', bottle: 'Flacon 5', variant: 'Étape 1 · rinçage', name: 'F5 Neutralisant', phase: 'N', order: 7, lines: [['peroxyde', 0.5], ['citrique', 2], ['ah', 1]],
    description: 'Premier flacon appliqué en Phase N. Stoppe l’action des réducteurs, referme les liaisons disulfures dans leur nouvelle position et amorce la reconstitution hydrique de la fibre.',
    usage: 'Toujours utilisé, en premier. Rinçage : oui. pH cible 2,5–3,5.', warning: 'F5 → F6 → F7 s’appliquent toujours dans cet ordre, sans les mélanger entre eux.' },
  { key: 'f6', bottle: 'Flacon 6', variant: 'Étape 2 · rinçage', name: 'F6 Soin Post-Transformation', phase: 'N', order: 8, lines: [['keratine', 10], ['soie', 5], ['riz', 5], ['aloe', 10], ['panthenol', 3]],
    description: 'Appliqué après rinçage du Flacon 5. Reconstitue les protéines mobilisées par la phase T et restaure l’hydratation de la fibre.',
    usage: 'Toujours utilisé, en deuxième. Rinçage : oui.', warning: '' },
  { key: 'f7', bottle: 'Flacon 7', variant: 'Étape finale · sans rinçage', name: 'F7 Fix', phase: 'N', order: 9, lines: [['peg12', 3], ['riz', 5], ['ah', 1], ['jojoba', 2]],
    description: 'Appliqué après rinçage du Flacon 6, sans rinçage. Scelle la cuticule, fixe définitivement le résultat et apporte brillance et protection mécanique.',
    usage: 'Toujours utilisé, en dernier. Rinçage : non.', warning: '' },
];

export const PHASE_LABEL = { T: 'Phase T — Transformante', N: 'Phase N — Nourrissante' };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function nextIngredientCode() {
  const codes = db.all('ingredients').map(i => /^ING-(\d+)$/.exec(i.code || '')).filter(Boolean).map(m => +m[1]);
  return 'ING-' + String((codes.length ? Math.max(...codes) : 0) + 1).padStart(3, '0');
}
/** Retrouve un ingrédient de l'inventaire par nom, INCI ou alias ; le crée (stock 0) s'il n'existe pas. */
export function resolveIngredient(key) {
  const def = ING[key];
  const wanted = new Set([def.name, def.inci, ...def.aliases].map(norm));
  const found = db.all('ingredients').find(i => wanted.has(norm(i.name)) || (i.inci && wanted.has(norm(i.inci))));
  if (found) return found;
  return db.insert('ingredients', { code: nextIngredientCode(), name: def.name, inci: def.inci, category: def.category, role: def.role, unit: 'g', stock: 0, minStock: 0, cost: 0, location: 'Laboratoire', notes: 'Référencé par le cahier de charge de la gamme (à approvisionner).' });
}

/** Crée les fiches théoriques du cahier de charge si elles n'existent pas encore. */
let seeding = false;
export function ensureRecipes() {
  if (seeding) return 0;
  seeding = true;
  let n = 0;
  try {
    // Doublons éventuels (créés par un rendu concurrent) : on garde la première fiche de chaque clé,
    // en y rattachant les formulations des copies supprimées.
    const seen = new Map();
    for (const r of db.all('recipes').slice()) {
      if (!r.key) continue;
      if (!seen.has(r.key)) { seen.set(r.key, r); continue; }
      const keep = seen.get(r.key);
      db.all('formulations').filter(f => f.recipeId === r.id).forEach(f => db.update('formulations', f.id, { recipeId: keep.id }));
      db.remove('recipes', r.id);
    }
    for (const r of RECIPES) {
      if (db.all('recipes').some(x => x.key === r.key)) continue;
      db.insert('recipes', { ...r, source: RECIPES_TAG });
      n++;
    }
  } finally { seeding = false; }
  return n;
}

/** Lignes concrètes d'une fiche (ingrédients résolus, eau en complément à 100 %). */
export function recipeLines(recipe) {
  const lines = (recipe.lines || []).map(([key, pct, role]) => { const ing = resolveIngredient(key); return { phase: ING[key].phase, ingredientId: ing.id, pct, role: role || ING[key].role, key }; });
  const water = Math.round((100 - lines.reduce((t, l) => t + l.pct, 0)) * 1000) / 1000;
  const eau = resolveIngredient('eau');
  return [{ phase: 'A', ingredientId: eau.id, pct: water, role: 'Véhicule (qsp 100)', key: 'eau' }, ...lines];
}
export const ingredientInfo = (key) => ING[key];
