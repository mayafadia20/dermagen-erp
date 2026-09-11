// Utilitaires d'interface : formatage, modales, formulaires, notifications.
import { db } from './store.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (n, cur) => {
  const c = cur || db.settings().currency || 'CAD';
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: c }).format(v);
};
export const num = (n, d = 2) => new Intl.NumberFormat('fr-CA', { maximumFractionDigits: d }).format(Number(n) || 0);
export const dateFmt = (s) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const daysUntil = (iso) => { if (!iso) return Infinity; const d = new Date(iso + 'T00:00:00'); return Math.round((d - new Date(today() + 'T00:00:00')) / 86400000); };

// Semaine ISO : retourne { year, week, key, label } ex. 2026-S37
export function isoWeek(iso) {
  const d = new Date((iso || today()) + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  const year = t.getUTCFullYear();
  return { year, week, key: `${year}-S${String(week).padStart(2, '0')}`, label: `Semaine ${week} · ${year}` };
}

export function toast(msg, type = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
}

export function badge(text, kind = 'grey') { return `<span class="badge ${kind}">${esc(text)}</span>`; }

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCSV(rows, columns) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [columns.map(c => q(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map(c => q(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(';'));
  return '﻿' + lines.join('\n');
}

// ---------- Modales ----------
let modalStack = [];
export function openModal({ title, body, footer, wide = false, onSubmit, submitLabel = 'Enregistrer', cancelLabel = 'Annuler', onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Fermer">✕</button></div>
      <form class="modal-body" novalidate>${body}</form>
      <div class="modal-foot">${footer ?? `<button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>${onSubmit ? `<button type="button" class="btn primary" data-submit>${esc(submitLabel)}</button>` : ''}`}</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  const form = overlay.querySelector('form');
  const close = () => {
    overlay.remove(); modalStack = modalStack.filter(m => m !== overlay);
    if (!modalStack.length) document.body.classList.remove('modal-open');
    onClose && onClose();
    document.dispatchEvent(new CustomEvent('modal-closed'));
  };
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  const submit = async () => {
    if (!form.reportValidity()) return;
    const data = formData(form);
    try {
      const r = await onSubmit(data, { form, close, overlay });
      if (r !== false) close();
    } catch (e) { console.error(e); toast(e.message || 'Erreur', 'err'); }
  };
  overlay.querySelector('[data-submit]')?.addEventListener('click', submit);
  form.addEventListener('submit', e => { e.preventDefault(); if (onSubmit) submit(); });
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (onSubmit) submit(); }
  });
  modalStack.push(overlay);
  setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 30);
  return { overlay, form, close };
}

export function confirmDialog(message, { title = 'Confirmer', danger = true, label = 'Confirmer' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button type="button" class="btn ghost" data-close>Annuler</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(label)}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    m.overlay.querySelector('[data-yes]').addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.closest('[data-repeat-row]')) continue; // lignes répétées gérées séparément
    const n = el.name;
    if (el.type === 'checkbox') out[n] = el.checked;
    else if (el.type === 'number') out[n] = el.value === '' ? null : Number(el.value);
    else out[n] = el.value.trim();
  }
  return out;
}

// ---------- Champs de formulaire ----------
export function field({ label, name, type = 'text', value = '', options, required, step, min, placeholder, rows = 3, help, list, cols = 1, attrs = '' }) {
  const id = 'f_' + name + '_' + Math.random().toString(36).slice(2, 6);
  const req = required ? 'required' : '';
  let input;
  const v = value ?? '';
  if (type === 'select') {
    input = `<select id="${id}" name="${name}" ${req} ${attrs}>${(options || []).map(o => {
      const [val, lab] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" rows="${rows}" ${req} placeholder="${esc(placeholder || '')}" ${attrs}>${esc(v)}</textarea>`;
  } else if (type === 'checkbox') {
    input = `<label class="check"><input type="checkbox" id="${id}" name="${name}" ${v ? 'checked' : ''} ${attrs}> <span>${esc(label)}</span></label>`;
    return `<div class="field cols-${cols}">${input}</div>`;
  } else {
    input = `<input id="${id}" type="${type}" name="${name}" value="${esc(v)}" ${req} ${step ? `step="${step}"` : ''} ${min !== undefined ? `min="${min}"` : ''} placeholder="${esc(placeholder || '')}" ${list ? `list="${list}"` : ''} ${attrs}>`;
  }
  return `<div class="field cols-${cols}"><label for="${id}">${esc(label)}${required ? ' <i>*</i>' : ''}</label>${input}${help ? `<small>${esc(help)}</small>` : ''}</div>`;
}

export function datalist(id, values) {
  return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

// ---------- Tableaux ----------
export function table({ columns, rows, empty = 'Aucun élément.', rowAttrs }) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr>${columns.map(c => `<th class="${c.align || ''}" ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr ${rowAttrs ? rowAttrs(r) : ''}>${columns.map(c => `<td class="${c.align || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function matches(obj, q, keys) {
  if (!q) return true;
  const s = q.toLowerCase();
  return keys.some(k => String(obj[k] ?? '').toLowerCase().includes(s));
}

export function statCard(label, value, sub = '', kind = '') {
  return `<div class="stat ${kind}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

// Conversion d'une quantité exprimée en grammes vers l'unité de stock de l'ingrédient
export function gramsToUnit(grams, unit) {
  switch (unit) { case 'kg': case 'L': return grams / 1000; default: return grams; }
}
export function costPerGram(ingredient) {
  const c = Number(ingredient.cost) || 0;
  switch (ingredient.unit) { case 'kg': case 'L': return c / 1000; default: return c; }
}
