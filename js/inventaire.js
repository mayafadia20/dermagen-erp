// Inventaire physique relevé sur les photos du 9 octobre 2026 (dossier « Photos_ingredients_et_laboratoire »).
// Import en un clic depuis la page Inventaire : crée les fournisseurs et ingrédients manquants
// (reconnus par nom, INCI ou alias s'ils existent déjà), complète leurs fiches (INCI, CAS, lot,
// péremption, fournisseur) et enregistre une entrée de stock pour chaque contenant photographié.
import { db } from './store.js';
import { today, toast, confirmDialog } from './ui.js';
import { recordMovement } from './modules/ingredients.js';

export const INVENTAIRE_TAG = 'inventaire-2026-10-09';
const DATE = '2026-10-09';
const LAB_CATEGORY = 'Matériel de laboratoire';

// Fournisseurs / marques lus sur les emballages
const SUPPLIERS = {
  mc:     { name: 'MakingCosmetics', website: 'https://www.makingcosmetics.com', address: '10800 231st Way NE', city: 'Redmond', province: 'WA', country: 'États-Unis', phone: '425 292-9502', currency: 'USD', categories: 'Actifs, conservateurs, émulsifiants, protéines' },
  myoc:   { name: 'MYOC — Make Your Own Cosmetics', country: 'Inde', categories: 'Alcool cétéarylique' },
  sture:  { name: 'Sturelehub', categories: 'Acide glycolique' },
  lhop:   { name: 'LHOPEBK Nature', categories: 'Beurre de karité' },
  mystic: { name: 'Mystic Moments', country: 'Royaume-Uni', website: 'https://www.mysticmomentsuk.com', categories: 'Acides aminés de soie' },
  amson:  { name: 'Amson Naturals', country: 'Canada', categories: 'Acide citrique' },
  hznx:   { name: 'Hznxolrc', categories: 'BTMS-50' },
  puro:   { name: 'Puroleo (Pureoyl Healthcare)', province: 'Ontario', country: 'Canada', website: 'https://www.puroleo.ca', email: 'contact@pureoyl.com', categories: 'Huiles végétales' },
  landart:{ name: 'Land Art', country: 'Canada', categories: 'Aloe vera' },
  yupik:  { name: 'Yupik', country: 'Canada', categories: 'Poudres biologiques' },
  labo:   { name: 'Fournisseur de verrerie (Labasics)', categories: 'Verrerie et matériel de laboratoire' },
};

// Ingrédients photographiés. qty/unit = contenu du contenant (plein, tel qu'acheté).
const ITEMS = [
  { name: 'Protéine de blé hydrolysée', inci: 'Water, Hydrolyzed Wheat Protein', cas: '7732-18-5, 70084-87-6', category: 'Actif', role: 'Protéine fortifiante (phase aqueuse, 1–5 %)', unit: 'ml', qty: 250, lot: 'B2943', supplier: 'mc', aliases: ['wheat protein hydrolysed', 'hydrolyzed wheat protein', 'protéine de blé'], photo: 'IMG_5958' },
  { name: 'Kératine hydrolysée', inci: 'Water, Hydrolyzed Keratin, Butylene Glycol', cas: '7732-18-5, 69430-36-0, 107-88-0', category: 'Actif', role: 'Protéine réparatrice (phase aqueuse, 1–5 %)', unit: 'ml', qty: 250, lot: 'E2746', supplier: 'mc', location: 'Réfrigérateur', notes: 'Conserver au réfrigérateur (étiquette).', aliases: ['keratin protein', 'keratin protein hydrolyzed', 'hydrolyzed keratin', 'kératine'], photo: 'IMG_5959' },
  { name: 'Acide hyaluronique', inci: 'Sodium Hyaluronate', cas: '9067-32-7', category: 'Actif', role: 'Hydratant filmogène', unit: 'g', qty: 50, lot: '25070502', supplier: 'mc', aliases: ['hyaluronic acid', 'sodium hyaluronate'], photo: 'IMG_5960' },
  { name: 'Acide glycolique', inci: 'Glycolic Acid', cas: '79-14-1', category: 'Actif', role: 'Actif exfoliant (AHA), poudre 99,9 %', unit: 'g', qty: 58, lot: 'MFG 03-17-2025', expiry: '2027-03-17', supplier: 'sture', notes: 'Deux boîtes de 29 g photographiées (IMG_5961 et IMG_5964) — vérifier qu’il s’agit bien de deux boîtes.', aliases: ['glycolic acid', 'glycolic acid powder'], photo: 'IMG_5961' },
  { name: 'Beurre de karité', inci: 'Butyrospermum Parkii Butter', category: 'Beurre', role: 'Émollient (100 % pur)', unit: 'g', qty: 120, supplier: 'lhop', aliases: ['shea butter', 'karité'], photo: 'IMG_5962' },
  { name: 'Protéine de soie hydrolysée', inci: 'Hydrolyzed Silk', category: 'Actif', role: 'Protéine lissante', unit: 'ml', qty: 60, lot: 'B2870', supplier: 'mc', aliases: ['silk protein hydrolyzed', 'hydrolyzed silk', 'protéine de soie'], photo: 'IMG_5963' },
  { name: 'Alcool cétéarylique', inci: 'Cetearyl Alcohol', cas: '67762-27-0', category: 'Épaississant', role: 'Épaississant / co-émulsifiant (grade cosmétique)', unit: 'g', qty: 454, supplier: 'myoc', notes: 'Deux sachets de 227 g photographiés (IMG_5965 et IMG_5981) — vérifier qu’il s’agit bien de deux sachets.', aliases: ['cetearyl alcohol', 'alcool cetearylique'], photo: 'IMG_5965' },
  { name: 'L-Arginine', inci: 'Arginine', cas: '74-79-3', category: 'Actif', role: 'Acide aminé (phase aqueuse, 0,1–5 %)', unit: 'g', qty: 50, lot: '2412EF0810', supplier: 'mc', aliases: ['arginine', 'l-arginine'], photo: 'IMG_5966' },
  { name: 'Polyquaternium-10', inci: 'Polyquaternium-10', cas: '68610-92-4', category: 'Agent conditionneur', role: 'Conditionneur cationique (0,2–2 %)', unit: 'g', qty: 125, lot: '58481', supplier: 'mc', aliases: ['polyquaternium 10', 'pq-10'], photo: 'IMG_5967' },
  { name: 'Acides aminés de soie', inci: 'Silk Amino Acids', category: 'Actif', role: 'Acides aminés de soie (poudre)', unit: 'g', qty: 25, lot: '4544807', expiry: '2027-06-30', supplier: 'mystic', notes: 'Date limite 06/2027 (étiquette « BBE »).', aliases: ['silk amino acid', 'silk amino acids'], photo: 'IMG_5968' },
  { name: 'Acide citrique', inci: 'Citric Acid', cas: '77-92-9', category: 'Ajusteur de pH', role: 'Ajusteur de pH (anhydre, origine naturelle)', unit: 'kg', qty: 2.27, supplier: 'amson', aliases: ['citric acid', 'acide citrique anhydre'], photo: 'IMG_5970' },
  { name: 'Poudre biologique Yupik (à identifier)', category: 'Autre', role: 'À identifier : l’étiquette du produit n’est pas visible sur la photo', unit: 'g', qty: 0, supplier: 'yupik', notes: 'Sachet Yupik « organic / biologique » de poudre blanche (IMG_5971). Nom du produit et poids à compléter.', aliases: ['yupik'], photo: 'IMG_5971' },
  { name: 'EDTA tétrasodique', inci: 'Tetrasodium EDTA', cas: '13235-36-4, 64-02-8', category: 'Autre', role: 'Chélatant (0,1–0,5 %)', unit: 'g', qty: 125, lot: '20241002', supplier: 'mc', notes: 'Le document de formulation parle d’« EDTA disodique » ; le produit en stock est l’EDTA tétrasodique (MakingCosmetics).', aliases: ['edta', 'edta disodique', 'disodium edta', 'tetrasodium edta'], photo: 'IMG_5973' },
  { name: 'D-Panthénol (Provitamine B5)', inci: 'D-Panthenol, Water, Pantolactone', cas: '81-13-0, 7732-18-5, 599-04-2', category: 'Actif', role: 'Hydratant / fortifiant (0,5–5 %)', unit: 'ml', qty: 250, lot: 'TL02409325', supplier: 'mc', aliases: ['panthénol', 'panthenol', 'd-panthénol', 'd-panthenol', 'provitamin b5', 'provitamine b5'], photo: 'IMG_5974' },
  { name: 'Phénoxyéthanol', inci: 'Phenoxyethanol', cas: '122-99-6', category: 'Conservateur', role: 'Conservateur (jusqu’à 1 %)', unit: 'ml', qty: 125, lot: '922892', supplier: 'mc', aliases: ['phenoxyethanol'], photo: 'IMG_5975' },
  { name: 'Caprylyl glycol', inci: 'Caprylyl Glycol', cas: '1117-86-8', category: 'Conservateur', role: 'Conservateur / humectant (1–2 %)', unit: 'L', qty: 1, lot: '250512-P002691', supplier: 'mc', aliases: ['caprylyl glycol'], photo: 'IMG_5976' },
  { name: 'Hydroxyethylcellulose', inci: 'Hydroxyethylcellulose', cas: '9004-62-0', category: 'Épaississant', role: 'Gélifiant / épaississant (0,5–3 %)', unit: 'g', qty: 125, lot: '390513', supplier: 'mc', aliases: ['he-cellulose', 'he-cellulose modified', 'hec'], photo: 'IMG_5977' },
  { name: 'Glycérine', inci: 'Glycerin', cas: '56-81-5', category: 'Humectant', role: 'Humectant (USP, 2–5 %)', unit: 'ml', qty: 473, lot: '25056-364', supplier: 'mc', aliases: ['glycerin', 'glycerin usp', 'glycérine végétale', 'glycerine'], photo: 'IMG_5978' },
  { name: 'Coco-Caprylate/Caprate', inci: 'Coco-Caprylate/Caprate', cas: '95912-86-0', category: 'Émollient', role: 'Émollient léger (phase grasse, 1–10 %)', unit: 'ml', qty: 500, lot: '250211-P001975', supplier: 'mc', aliases: ['coco caprylate caprate', 'coco-caprylate'], photo: 'IMG_5979' },
  { name: 'Sodium PCA', inci: 'Water, Sodium PCA, Sodium Salicylate, Sodium Benzoate', cas: '7732-18-5, 28874-51-3, 54-21-7, 532-32-1', category: 'Humectant', role: 'Humectant NMF (1–10 %)', unit: 'ml', qty: 500, lot: 'PCA50-250108-1', supplier: 'mc', aliases: ['sodium pca'], photo: 'IMG_5980' },
  { name: 'BTMS-50', inci: 'Behentrimonium Methosulfate (and) Cetyl Alcohol (and) Butylene Glycol', category: 'Agent conditionneur', role: 'Émulsifiant conditionneur', unit: 'kg', qty: 1, supplier: 'hznx', aliases: ['btms 50', 'btms-50', 'btms', 'btms 50 conditioning emulsifier'], photo: 'IMG_5982' },
  { name: 'Huile de jojoba', inci: 'Simmondsia Chinensis (Jojoba) Seed Oil', category: 'Huile', role: 'Émollient nourrissant (pure et naturelle)', unit: 'ml', qty: 946, supplier: 'puro', aliases: ['jojoba oil', 'jojoba'], photo: 'IMG_5983' },
  { name: 'Gel d’aloe vera', inci: 'Aloe Barbadensis Leaf Juice', category: 'Actif', role: 'Hydratant apaisant (gel 99 % pur, grade alimentaire)', unit: 'L', qty: 1.5, supplier: 'landart', notes: 'Produit « Digestive health » Land Art, NPN 80045528 : grade alimentaire, non cosmétique.', aliases: ['aloe vera', 'aloe vera gel', 'aloe'], photo: 'IMG_5984' },
];

// Verrerie et matériel comptés sur les photos IMG_5985 à IMG_5987 (à vérifier sur place).
const EQUIPMENT = [
  { name: 'Bécher 1000 ml', qty: 2 },
  { name: 'Bécher 600 ml', qty: 1 },
  { name: 'Bécher 250 ml', qty: 5, notes: 'Marque Labasics.' },
  { name: 'Bécher 100 ml', qty: 4, notes: 'Marque Labasics.' },
  { name: 'Bécher 50 ml', qty: 4 },
  { name: 'Bécher 30 ml', qty: 2 },
  { name: 'Éprouvette graduée 100 ml', qty: 1 },
  { name: 'Éprouvette graduée 50 ml', qty: 1 },
  { name: 'Éprouvette graduée 10 ml', qty: 1 },
  { name: 'Tube à essai gradué 10 ml (à pied)', qty: 5 },
  { name: 'Erlenmeyer plastique 500 ml', qty: 1 },
  { name: 'Poire à pipette (petite, rouge)', qty: 10 },
  { name: 'Poire à pipette (grande, rouge)', qty: 1 },
  { name: 'Pipette Pasteur en verre', qty: 2 },
  { name: 'Spatule inox', qty: 3 },
  { name: 'Barreau magnétique', qty: 1 },
  { name: 'Seringue 50 ml', qty: 1 },
  { name: 'Agitateur en verre (tige)', qty: 1 },
  { name: 'Thermomètre de laboratoire', qty: 1 },
  { name: 'Entonnoir / filtre', qty: 1 },
  { name: 'Balance de précision UXILAII Scientific', qty: 1, notes: 'Vue en arrière-plan des photos.' },
  { name: 'pH-mètre de table NANBEI', qty: 1, notes: 'Vu en arrière-plan (IMG_5971).' },
  { name: 'Agitateur mécanique à tige (overhead)', qty: 1, notes: 'Vu en arrière-plan des photos.' },
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function nextCode(prefix) {
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  const codes = db.all('ingredients').map(i => re.exec(i.code || '')).filter(Boolean).map(m => +m[1]);
  return prefix + '-' + String((codes.length ? Math.max(...codes) : 0) + 1).padStart(3, '0');
}

function supplierId(key) {
  const def = SUPPLIERS[key]; if (!def) return '';
  const found = db.all('suppliers').find(s => norm(s.name) === norm(def.name) || norm(s.name).startsWith(norm(def.name.split(' ')[0])) && def.name.split(' ')[0].length > 5);
  if (found) return found.id;
  return db.insert('suppliers', { currency: 'CAD', paymentTerms: 'Paiement à la commande', ...def, notes: 'Créé lors de l’import de l’inventaire photographié (9 oct. 2026).' }).id;
}

function findIngredient(item) {
  const wanted = new Set([item.name, item.inci, ...(item.aliases || [])].filter(Boolean).map(norm));
  return db.all('ingredients').find(i => wanted.has(norm(i.name)) || (i.inci && wanted.has(norm(i.inci))));
}

// Convertit une quantité exprimée dans l'unité de l'emballage vers l'unité de stock de la fiche
function convert(qty, from, to) {
  const big = (u) => u === 'kg' || u === 'L';
  if (big(from) === big(to)) return qty;
  return big(from) ? qty * 1000 : qty / 1000;
}

export function inventaireDone() { return db.all('movements').some(m => m.ref === INVENTAIRE_TAG); }

export async function importInventaire(navigate) {
  if (inventaireDone()) { toast('L’inventaire photographié a déjà été importé.', 'warn'); return; }
  if (!await confirmDialog(`Importer l’inventaire photographié le 9 octobre 2026 ? ${ITEMS.length} ingrédients (entrée de stock = contenu des emballages) et ${EQUIPMENT.length} types de matériel de laboratoire seront ajoutés. Les fiches existantes sont complétées, pas dupliquées.`, { danger: false, label: 'Importer' })) return;

  const s = db.settings();
  if (!(s.categories || []).includes(LAB_CATEGORY)) db.saveSettings({ categories: [...s.categories, LAB_CATEGORY] });

  let createdIng = 0, updatedIng = 0;
  for (const it of ITEMS) {
    const sid = it.supplier ? supplierId(it.supplier) : '';
    let ing = findIngredient(it);
    if (!ing) {
      ing = db.insert('ingredients', { code: nextCode('ING'), name: it.name, inci: it.inci || '', cas: it.cas || '', category: it.category, role: it.role, unit: it.unit, stock: 0, minStock: 0, cost: 0, supplierId: sid, lot: it.lot || '', expiry: it.expiry || '', location: it.location || 'Laboratoire', notes: [it.notes, `Photo ${it.photo}.`].filter(Boolean).join(' ') });
      createdIng++;
    } else {
      const patch = {};
      if (!ing.inci && it.inci) patch.inci = it.inci;
      if (!ing.cas && it.cas) patch.cas = it.cas;
      if (!ing.supplierId && sid) patch.supplierId = sid;
      if (it.lot) patch.lot = it.lot;
      if (it.expiry) patch.expiry = it.expiry;
      if (it.location && !ing.location) patch.location = it.location;
      if (!ing.role && it.role) patch.role = it.role;
      patch.notes = [ing.notes, it.notes, `Photo ${it.photo}.`].filter(Boolean).join(' ');
      db.update('ingredients', ing.id, patch);
      updatedIng++;
    }
    const delta = convert(it.qty, it.unit, ing.unit);
    if (delta > 0) recordMovement(ing.id, delta, { type: 'entree', reason: `Inventaire photographié — ${it.qty} ${it.unit} (${it.photo})`, ref: INVENTAIRE_TAG, lot: it.lot || '', date: DATE });
  }

  const labSid = supplierId('labo');
  let createdEq = 0;
  for (const e of EQUIPMENT) {
    let ing = db.all('ingredients').find(i => norm(i.name) === norm(e.name));
    if (!ing) { ing = db.insert('ingredients', { code: nextCode('LAB'), name: e.name, category: LAB_CATEGORY, unit: 'unité', stock: 0, minStock: 0, cost: 0, supplierId: labSid, location: 'Laboratoire', notes: [e.notes, 'Compté sur les photos IMG_5985 à IMG_5987 du 9 oct. 2026 — à vérifier sur place.'].filter(Boolean).join(' ') }); createdEq++; }
    recordMovement(ing.id, e.qty, { type: 'entree', reason: 'Inventaire photographié (verrerie et matériel)', ref: INVENTAIRE_TAG, date: DATE });
  }

  toast(`Inventaire importé : ${createdIng} ingrédient(s) créé(s), ${updatedIng} complété(s), ${createdEq} article(s) de matériel`);
  navigate && navigate('ingredients');
}
