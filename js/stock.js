// Disponibilité d'un ingrédient pour une formule : compare la quantité nécessaire au stock de l'inventaire.
import { num, esc, gramsToUnit } from './ui.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Vrai si l'ingrédient est l'eau de la formule (complément à 100 %, « qsp »). */
export function isWater(ing) {
  if (!ing) return false;
  const inci = norm(ing.inci), name = norm(ing.name);
  return inci === 'aqua' || inci === 'water' || inci === 'aqua water' || /^eau( |$)/.test(name) || name === 'water';
}
export const isWaterName = (name, inci) => isWater({ name, inci });

/**
 * Statut de stock pour une quantité en grammes.
 *  - Disponible : le stock couvre la quantité
 *  - Partiel    : il y a du stock, mais pas assez
 *  - Rupture    : stock nul, ou ingrédient absent de l'inventaire
 */
export function stockFor(ing, grams) {
  if (!ing) return { kind: 'red', label: 'Rupture', detail: 'Absent de l’inventaire', need: grams, have: 0, missing: true };
  const unit = ing.unit || 'g';
  const need = gramsToUnit(Number(grams) || 0, unit);
  const have = Number(ing.stock) || 0;
  const detail = `${num(have, 3)} ${unit} en stock · besoin ${num(need, 3)} ${unit}`;
  if (have <= 0) return { kind: 'red', label: 'Rupture', detail, need, have };
  if (need > 0 && have < need) return { kind: 'amber', label: 'Partiel', detail, need, have };
  return { kind: 'green', label: 'Disponible', detail, need, have };
}

export function stockBadge(ing, grams) {
  const s = stockFor(ing, grams);
  return `<span class="badge ${s.kind}" title="${esc(s.detail)}">${s.label}</span>`;
}
