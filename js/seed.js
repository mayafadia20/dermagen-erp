// Jeu de données de démonstration (fictif) pour explorer l'ERP.
import { db } from './store.js';
import { today, addDays, isoWeek, toast, confirmDialog } from './ui.js';
import { recordMovement } from './modules/ingredients.js';
import { computeTaxes } from './modules/purchases.js';

export async function seedDemo() {
  const hasData = db.all('ingredients').length || db.all('suppliers').length;
  if (hasData && !await confirmDialog('Des données existent déjà. Ajouter quand même le jeu de démonstration (les données actuelles seront conservées) ?', { danger: false, label: 'Ajouter' })) return;
  const t = today();

  const s1 = db.insert('suppliers', { name: 'Chimie Cosmétique Québec', contactName: 'Julie Tremblay', contactTitle: 'Représentante des ventes', email: 'jtremblay@ccq-exemple.ca', phone: '514 555-0142', website: 'https://ccq-exemple.ca', address: '1200 rue Sainte-Catherine O.', city: 'Montréal', province: 'Québec', country: 'Canada', paymentTerms: 'Net 30', currency: 'CAD', leadTime: 5, categories: 'Actifs, tensioactifs, conditionneurs', notes: 'Minimum de commande 250 $. Livraison gratuite dès 500 $.' });
  const s2 = db.insert('suppliers', { name: 'Naturalis Botanica', contactName: 'Marc Fortin', email: 'ventes@naturalis-exemple.com', phone: '450 555-0198', city: 'Laval', province: 'Québec', country: 'Canada', paymentTerms: 'Net 15', currency: 'CAD', leadTime: 7, categories: 'Huiles végétales, beurres, extraits', notes: 'Certificats d’analyse fournis sur demande.' });
  const s3 = db.insert('suppliers', { name: 'PackPro Emballages', contactName: 'Sophie Nguyen', email: 'sophie@packpro-exemple.ca', phone: '438 555-0177', city: 'Longueuil', province: 'Québec', country: 'Canada', paymentTerms: 'Paiement à la commande', currency: 'CAD', leadTime: 14, categories: 'Flacons, capsules, sachets' });

  const mk = (o) => db.insert('ingredients', o);
  const water = mk({ code: 'ING-001', name: 'Eau déminéralisée', inci: 'Aqua', category: 'Solvant', unit: 'L', stock: 0, minStock: 5, cost: 1.2, supplierId: s1.id, location: 'Réserve' });
  const cetearyl = mk({ code: 'ING-002', name: 'Alcool cétéarylique', inci: 'Cetearyl Alcohol', cas: '67762-27-0', category: 'Épaississant', unit: 'kg', stock: 0, minStock: 1, cost: 18.5, supplierId: s1.id, role: 'Épaississant / co-émulsifiant', location: 'Armoire A' });
  const btms = mk({ code: 'ING-003', name: 'BTMS-50', inci: 'Behentrimonium Methosulfate (and) Cetyl Alcohol (and) Butylene Glycol', category: 'Agent conditionneur', unit: 'kg', stock: 0, minStock: 1, cost: 42, supplierId: s1.id, role: 'Émulsifiant conditionneur', location: 'Armoire A' });
  const keratin = mk({ code: 'ING-004', name: 'Kératine hydrolysée', inci: 'Hydrolyzed Keratin', category: 'Actif', unit: 'g', stock: 0, minStock: 200, cost: 0.19, supplierId: s1.id, role: 'Actif réparateur', location: 'Frigo', expiry: addDays(t, 40) });
  const argan = mk({ code: 'ING-005', name: 'Huile d’argan bio', inci: 'Argania Spinosa Kernel Oil', category: 'Huile', unit: 'L', stock: 0, minStock: 0.5, cost: 95, supplierId: s2.id, role: 'Émollient nourrissant', location: 'Armoire B' });
  const shea = mk({ code: 'ING-006', name: 'Beurre de karité', inci: 'Butyrospermum Parkii Butter', category: 'Beurre', unit: 'kg', stock: 0, minStock: 0.5, cost: 24, supplierId: s2.id, role: 'Émollient', location: 'Armoire B' });
  const glycerin = mk({ code: 'ING-007', name: 'Glycérine végétale', inci: 'Glycerin', cas: '56-81-5', category: 'Humectant', unit: 'kg', stock: 0, minStock: 1, cost: 9.8, supplierId: s2.id, role: 'Humectant', location: 'Armoire A' });
  const preserv = mk({ code: 'ING-008', name: 'Conservateur Geogard ECT', inci: 'Benzyl Alcohol (and) Salicylic Acid (and) Glycerin (and) Sorbic Acid', category: 'Conservateur', unit: 'g', stock: 0, minStock: 100, cost: 0.12, supplierId: s1.id, role: 'Conservateur large spectre', location: 'Armoire A' });
  const panthenol = mk({ code: 'ING-009', name: 'D-Panthénol', inci: 'Panthenol', cas: '81-13-0', category: 'Actif', unit: 'g', stock: 0, minStock: 100, cost: 0.09, supplierId: s1.id, role: 'Hydratant / fortifiant', location: 'Armoire A' });
  const lactic = mk({ code: 'ING-010', name: 'Acide lactique 80 %', inci: 'Lactic Acid', category: 'Ajusteur de pH', unit: 'g', stock: 0, minStock: 50, cost: 0.05, supplierId: s1.id, role: 'Ajusteur de pH', location: 'Armoire C' });
  const flacon = mk({ code: 'ING-011', name: 'Flacon PET 250 ml + pompe', category: 'Emballage', unit: 'unité', stock: 0, minStock: 50, cost: 1.85, supplierId: s3.id, location: 'Réserve' });

  const init = [[water, 20, 'L-2409'], [cetearyl, 2.5, 'CA-1187'], [btms, 1.2, 'BT-552'], [keratin, 350, 'KH-0091'], [argan, 0.4, 'AR-24-07'], [shea, 1.8, 'SK-2211'], [glycerin, 3, 'GL-9034'], [preserv, 400, 'GE-118'], [panthenol, 250, 'PA-771'], [lactic, 300, 'LA-40'], [flacon, 120, '']];
  for (const [ing, qty, lot] of init) recordMovement(ing.id, qty, { type: 'entree', reason: 'Stock initial (démo)', lot, date: addDays(t, -30) });
  init.forEach(([ing, , lot]) => lot && db.update('ingredients', ing.id, { lot }));

  const d1 = addDays(t, -14), d2 = addDays(t, -7), d3 = t;
  const f1 = db.insert('formulations', {
    code: `F-${isoWeek(d1).year}-S${String(isoWeek(d1).week).padStart(2, '0')}-01`, name: 'Masque réparateur kératine', version: 1, date: d1, weekKey: isoWeek(d1).key, productType: 'Masque', status: 'En test', batchSize: 500, author: 'Oumaima',
    objective: 'Réparer la fibre sur cheveux poreux sans formaldéhyde ni chaleur.',
    lines: [
      { phase: 'A', ingredientId: water.id, pct: 71.5, role: 'Solvant' }, { phase: 'A', ingredientId: glycerin.id, pct: 3, role: 'Humectant' },
      { phase: 'B', ingredientId: btms.id, pct: 6, role: 'Émulsifiant conditionneur' }, { phase: 'B', ingredientId: cetearyl.id, pct: 4, role: 'Épaississant' }, { phase: 'B', ingredientId: shea.id, pct: 5, role: 'Émollient' }, { phase: 'B', ingredientId: argan.id, pct: 2, role: 'Émollient' },
      { phase: 'C', ingredientId: keratin.id, pct: 5, role: 'Actif réparateur' }, { phase: 'C', ingredientId: panthenol.id, pct: 2, role: 'Fortifiant' }, { phase: 'C', ingredientId: preserv.id, pct: 1, role: 'Conservateur' }, { phase: 'C', ingredientId: lactic.id, pct: 0.5, role: 'pH' }
    ],
    procedure: 'Phase A : chauffer à 75 °C.\nPhase B : fondre à 75 °C, verser dans A sous agitation 3 min.\nRefroidir à 40 °C, ajouter la phase C. Ajuster le pH à 4,5–5.',
    ph: '4,8', viscosity: 'Crème épaisse, onctueuse', aspect: 'Blanc ivoire, odeur neutre', stability: 'Stable 2 sem. à 40 °C (test en cours)',
    result: 'Test salon (3 clientes, cheveux poreux) : toucher amélioré, brillance +. Légère lourdeur sur cheveux fins.', notes: 'Réduire le karité à 3 % pour la v2.'
  });
  db.insert('formulations', {
    code: `F-${isoWeek(d2).year}-S${String(isoWeek(d2).week).padStart(2, '0')}-01`, name: 'Masque réparateur kératine', version: 2, parentCode: f1.code, date: d2, weekKey: isoWeek(d2).key, productType: 'Masque', status: 'En développement', batchSize: 500, author: 'Oumaima',
    objective: 'v2 : alléger la texture pour cheveux fins.',
    lines: [
      { phase: 'A', ingredientId: water.id, pct: 74.5, role: 'Solvant' }, { phase: 'A', ingredientId: glycerin.id, pct: 3, role: 'Humectant' },
      { phase: 'B', ingredientId: btms.id, pct: 5, role: 'Émulsifiant conditionneur' }, { phase: 'B', ingredientId: cetearyl.id, pct: 3, role: 'Épaississant' }, { phase: 'B', ingredientId: shea.id, pct: 3, role: 'Émollient' }, { phase: 'B', ingredientId: argan.id, pct: 3, role: 'Émollient' },
      { phase: 'C', ingredientId: keratin.id, pct: 5, role: 'Actif réparateur' }, { phase: 'C', ingredientId: panthenol.id, pct: 2, role: 'Fortifiant' }, { phase: 'C', ingredientId: preserv.id, pct: 1, role: 'Conservateur' }, { phase: 'C', ingredientId: lactic.id, pct: 0.5, role: 'pH' }
    ],
    procedure: 'Idem v1.', ph: '4,9', viscosity: 'Crème moyenne', aspect: 'Blanc ivoire', stability: 'À tester', result: '', notes: 'Lancer le test de stabilité 4 semaines.'
  });
  db.insert('formulations', {
    code: `F-${isoWeek(d3).year}-S${String(isoWeek(d3).week).padStart(2, '0')}-01`, name: 'Sérum fortifiant sans rinçage', version: 1, date: d3, weekKey: isoWeek(d3).key, productType: 'Sérum', status: 'En développement', batchSize: 200, author: 'Maya',
    objective: 'Sérum léger pour entretien entre deux protocoles en salon.',
    lines: [
      { phase: 'A', ingredientId: water.id, pct: 88, role: 'Solvant' }, { phase: 'A', ingredientId: glycerin.id, pct: 4, role: 'Humectant' },
      { phase: 'B', ingredientId: keratin.id, pct: 4, role: 'Actif' }, { phase: 'B', ingredientId: panthenol.id, pct: 3, role: 'Actif' }, { phase: 'B', ingredientId: preserv.id, pct: 1, role: 'Conservateur' }
    ],
    procedure: 'Mélanger à froid sous agitation. Ajuster le pH.', ph: '', notes: 'Première itération.'
  });

  const poLines = [
    { ingredientId: keratin.id, description: 'Kératine hydrolysée', qty: 1000, unit: 'g', unitPrice: 0.18 },
    { ingredientId: btms.id, description: 'BTMS-50', qty: 2, unit: 'kg', unitPrice: 41 },
    { ingredientId: preserv.id, description: 'Geogard ECT', qty: 500, unit: 'g', unitPrice: 0.12 }
  ];
  const sub1 = poLines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const po1 = db.insert('purchases', { number: `BC-${new Date().getFullYear()}-001`, supplierId: s1.id, date: addDays(t, -20), expectedDate: addDays(t, -12), status: 'Reçue', receivedAt: addDays(t, -12), lines: poLines, applyTaxes: true, shipping: 0, ...computeTaxes(sub1, 0, true) });
  const po2Lines = [{ ingredientId: argan.id, description: 'Huile d’argan bio', qty: 1, unit: 'L', unitPrice: 92 }, { ingredientId: shea.id, description: 'Beurre de karité', qty: 2, unit: 'kg', unitPrice: 23.5 }];
  const sub2 = po2Lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  db.insert('purchases', { number: `BC-${new Date().getFullYear()}-002`, supplierId: s2.id, date: addDays(t, -3), expectedDate: addDays(t, 4), status: 'Envoyée', lines: po2Lines, applyTaxes: true, shipping: 15, ...computeTaxes(sub2, 15, true) });

  const inv1 = db.insert('invoices', { number: `FA-${new Date().getFullYear()}-001`, supplierInvoiceNumber: 'CCQ-48213', supplierId: s1.id, purchaseId: po1.id, date: addDays(t, -12), dueDate: addDays(t, 18), description: `Commande ${po1.number}`, applyTaxes: true, shipping: 0, ...computeTaxes(sub1, 0, true) });
  db.update('purchases', po1.id, { invoiceId: inv1.id });
  db.insert('payments', { invoiceId: inv1.id, date: addDays(t, -5), amount: 150, method: 'Virement bancaire', reference: 'VIR-20931', notes: 'Acompte' });
  const inv2 = db.insert('invoices', { number: `FA-${new Date().getFullYear()}-002`, supplierInvoiceNumber: 'PP-1187', supplierId: s3.id, date: addDays(t, -45), dueDate: addDays(t, -15), description: 'Flacons 250 ml (120 unités)', applyTaxes: true, shipping: 25, ...computeTaxes(222, 25, true) });
  void inv2;

  toast('Données de démonstration chargées');
  location.hash = '#/dashboard';
}
