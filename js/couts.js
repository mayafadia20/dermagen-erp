// Coût des ingrédients de l'inventaire à partir des factures Amazon importées (js/amazon.js) :
// pour chaque ingrédient, l'achat le plus récent donne le coût unitaire = prix avant taxes ÷ contenu de l'emballage,
// converti dans l'unité de l'ingrédient (g, kg, ml, L). Les taxes (TPS/TVQ récupérables) ne sont pas incluses.
import { db } from './store.js';
import { toast, confirmDialog, money, num } from './ui.js';
import { amazonInvoices, AMAZON_TAG } from './amazon.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// ASIN → contenu d'un emballage (qty dans l'unité de base g ou ml) et noms possibles dans l'inventaire.
// `note` signale une correspondance à vérifier.
const MAP = [
  { asin: 'B09M7KWWS2', qty: 946, unit: 'ml', names: ['huile de jojoba', 'jojoba oil', 'jojoba', 'simmondsia chinensis (jojoba) seed oil'] },
  { asin: 'B07BYPW7LZ', qty: 120, unit: 'ml', names: ['huile de jojoba', 'jojoba oil', 'jojoba'] },
  { asin: 'B07581VJ8Y', qty: 2270, unit: 'g', names: ['acide citrique', 'citric acid', 'acide citrique anhydre'] },
  { asin: 'B07S8YMS83', qty: 340, unit: 'ml', names: ['gel d aloe vera', 'aloe vera', 'aloe vera gel', 'aloe', 'aloe barbadensis leaf juice'], note: 'produit NAKA 340 ml, différent du gel Land Art de l’inventaire' },
  { asin: 'B0CZZXWCYJ', qty: 25, unit: 'g', names: ['acide hyaluronique', 'hyaluronic acid', 'sodium hyaluronate'], note: 'format 25 g d’après la facture (l’inventaire indique 50 g)' },
  { asin: 'B0774TN3SL', qty: 1000, unit: 'g', names: ['beurre de karite', 'shea butter', 'karite', 'butyrospermum parkii butter'] },
  { asin: 'B079MCCJBT', qty: 250, unit: 'g', names: ['beurre de karite', 'shea butter', 'karite', 'butyrospermum parkii butter'] },
  { asin: 'B0G2Y668BT', qty: 120, unit: 'g', names: ['beurre de karite', 'shea butter', 'karite', 'butyrospermum parkii butter'], note: 'pot LHOPEBK 4,2 oz ≈ 120 g' },
  { asin: 'B0CZMNL9T7', qty: 28.35, unit: 'g', names: ['acide glycolique', 'glycolic acid', 'glycolic acid powder'] },
  { asin: 'B0CMX5NSY2', qty: 50, unit: 'g', names: ['proteine de ble hydrolysee', 'hydrolyzed wheat protein', 'proteine de ble', 'wheat protein hydrolysed'], note: 'poudre 50 g, inventaire en ml (densité ≈ 1)' },
  { asin: 'B01FSTJVVG', qty: 25, unit: 'g', names: ['acides amines de soie', 'silk amino acids', 'silk amino acid'] },
  { asin: 'B07HNQPGFK', qty: 1000, unit: 'g', names: ['poudre biologique yupik (a identifier)', 'poudre biologique yupik a identifier', 'yupik', 'proteine de riz brun yupik (poudre)', 'proteine de riz brun yupik poudre'],
    rename: { name: 'Protéine de riz brun Yupik (poudre)', inci: 'Oryza Sativa (Rice) Protein', role: 'Protéine de riz brun biologique 80 % (poudre alimentaire Yupik, 1 kg) — identifiée par la facture Amazon du 23 juill. 2026' } },
  { asin: 'B0D3QC8ZJ3', qty: 227, unit: 'g', names: ['alcool cetearylique', 'cetearyl alcohol', 'alcool cetearylique'] },
  { asin: 'B0DK3HWSDH', qty: 998, unit: 'g', names: ['btms 50', 'btms-50', 'btms', 'behentrimonium methosulfate (and) cetyl alcohol (and) butylene glycol'], note: '2,2 lb = 998 g' },
  { asin: 'B0CHLDH5CF', qty: 12000, unit: 'ml', names: ['eau purifiee', 'eau demineralisee', 'eau distillee', 'eau', 'aqua', 'water'], note: '24 bouteilles de 500 ml' },
];

const toBase = { g: 1, kg: 1000, ml: 1, L: 1000, unité: 1 };

function findIngredient(names) {
  const wanted = new Set(names.map(norm));
  return db.all('ingredients').find(i => wanted.has(norm(i.name)) || (i.inci && wanted.has(norm(i.inci))) || (i.aliases || []).some(a => wanted.has(norm(a)))) || null;
}

/** Propositions de mise à jour : une par ingrédient trouvé, basée sur l'achat le plus récent. */
export function costProposals() {
  const lines = [];
  for (const inv of amazonInvoices()) for (const l of inv.lines) lines.push({ ...l, date: inv.date, invoice: inv.invoice });
  const byIng = new Map();
  for (const m of MAP) {
    const ing = findIngredient(m.names); if (!ing) continue;
    const buys = lines.filter(l => l.asin === m.asin).sort((a, b) => b.date.localeCompare(a.date));
    if (!buys.length) continue;
    const b = buys[0];
    const baseQty = b.qty * m.qty;                       // contenu total acheté, en g ou ml
    const perBase = b.subtotal / baseQty;                // $ par g ou ml, avant taxes
    const cost = Math.round(perBase * (toBase[ing.unit] || 1) * 10000) / 10000;
    const cur = byIng.get(ing.id);
    if (cur && cur.date >= b.date) continue;
    byIng.set(ing.id, { ing, map: m, line: b, date: b.date, cost, unit: ing.unit, source: `Amazon ${b.invoice} (${b.date})`, note: m.note || '' });
  }
  return [...byIng.values()].sort((a, b) => a.ing.name.localeCompare(b.ing.name));
}

export const costsUpToDate = () => { const p = costProposals(); return p.length > 0 && p.every(x => x.ing.costSource === x.source && Math.abs((Number(x.ing.cost) || 0) - x.cost) < 0.00005); };
export const amazonAvailable = () => db.all('invoices').some(i => i.importTag === AMAZON_TAG);

export async function updateCostsFromAmazon(navigate) {
  const props = costProposals();
  if (!props.length) { toast('Aucun ingrédient de l’inventaire ne correspond aux achats Amazon.', 'warn'); return; }
  const changes = props.filter(p => p.ing.costSource !== p.source || Math.abs((Number(p.ing.cost) || 0) - p.cost) >= 0.00005);
  if (!changes.length) { toast('Les coûts sont déjà à jour avec les factures Amazon.', 'warn'); return; }
  const rows = changes.map(p => `<tr><td>${p.ing.name}${p.map.rename ? ' → <b>' + p.map.rename.name + '</b>' : ''}</td><td class="num">${money(p.ing.cost)} / ${p.unit}</td><td class="num"><b>${money(p.cost)} / ${p.unit}</b></td><td class="muted">${p.line.item.slice(0, 48)} · ${num(p.line.qty * p.map.qty, 0)} ${p.map.unit} pour ${money(p.line.subtotal)} avant taxes${p.note ? '<br>⚠ ' + p.note : ''}</td></tr>`).join('');
  const ok = await confirmDialog(`<p>Mettre à jour le coût unitaire de ${changes.length} ingrédient(s) d’après l’achat Amazon le plus récent (prix avant taxes ÷ contenu de l’emballage) ?</p><div class="table-wrap" style="margin-top:10px;max-height:50vh;overflow:auto"><table><thead><tr><th>Ingrédient</th><th class="num">Actuel</th><th class="num">Nouveau</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>`, { danger: false, label: 'Mettre à jour', title: 'Coûts depuis les factures Amazon', html: true });
  if (!ok) return;
  let n = 0;
  for (const p of changes) {
    const patch = { cost: p.cost, costSource: p.source, costDate: p.date, costNote: p.note };
    if (p.map.rename && /a identifier/.test(norm(p.ing.name))) Object.assign(patch, p.map.rename);
    db.update('ingredients', p.ing.id, patch); n++;
  }
  toast(`${n} coût(s) d’ingrédient mis à jour`);
  navigate && navigate('ingredients');
}
