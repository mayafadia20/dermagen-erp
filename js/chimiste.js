// Assistante chimiste : construit le contexte (skill + données de l'ERP) et interroge l'API Claude
// directement depuis le navigateur, en flux (SSE). Aucun serveur intermédiaire : la clé API est
// celle enregistrée dans les Paramètres et ne quitte ce navigateur que vers api.anthropic.com.
import { db } from './store.js';
import { num, dateFmt } from './ui.js';

export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (recommandé)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (plus rapide, moins cher)'],
];
export const EFFORTS = [['low', 'Rapide'], ['medium', 'Équilibré'], ['high', 'Approfondi']];

export const SKILLS = {
  chimiste: { id: 'chimiste', file: 'skills/chimiste-cosmetique/SKILL.md', label: 'Chimiste cosmétique', icon: '⚗', tagline: 'Formulation, procédé, pH, conservation, stabilité, faisabilité selon le stock.' },
  cosmetologue: { id: 'cosmetologue', file: 'skills/cosmetologue/SKILL.md', label: 'Cosmétologue', icon: '✿', tagline: 'Science du cheveu, efficacité et tolérance, protocoles en salon, allégations et étiquetage au Canada.' },
};
export const DEFAULT_SKILL = 'chimiste';
export const skillInfo = (id) => SKILLS[id] || SKILLS[DEFAULT_SKILL];

const cache = {};
async function fetchText(path) { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.text(); }
export async function loadSkill(id = DEFAULT_SKILL) {
  const info = skillInfo(id);
  if (cache[info.id]) return cache[info.id];
  let text;
  try { text = (await fetchText(info.file)).replace(/^---[\s\S]*?---\s*/, ''); }
  catch (e) { console.warn('Skill introuvable, repli sur la version intégrée', info.file, e); text = info.id === 'cosmetologue' ? FALLBACK_COSMETO : FALLBACK_SKILL; }
  try { cache.refs = cache.refs || await fetchText('skills/references.md'); text += '\n\n' + cache.refs; } catch (_) {}
  cache[info.id] = text;
  return text;
}

const FALLBACK_COSMETO = `# Rôle
Tu es un·e cosmétologue sénior (science du cheveu et du cuir chevelu, efficacité et tolérance, protocoles de salon, allégations et étiquetage des cosmétiques au Canada) qui accompagne la formulatrice de DermaGen (Montréal). Réponds en français, de façon concise. Utilise le bloc « Contexte ERP » fourni, n'invente ni étude ni règle, et rappelle que les allégations doivent rester cosmétiques au sens de la Loi sur les aliments et drogues.`;

const FALLBACK_SKILL = `# Rôle
Tu es un·e chimiste cosmétique sénior spécialisé·e en soins capillaires qui accompagne la formulatrice de DermaGen (Montréal). Réponds en français, de façon concise et rigoureuse. Utilise le bloc « Contexte ERP » fourni (inventaire, matériel, formulations) pour vérifier la faisabilité, signale ce qui manque, et n'invente jamais de données. Avant un essai, vérifie : objectif, composition à 100 % et plages d'usage, compatibilité des charges, disponibilité en stock, procédé et températures, pH cible, sécurité au laboratoire, documentation et tests de stabilité. Rappelle que tu ne remplaces ni l'évaluation de sécurité ni les tests de conservation.`;

// ---------- Contexte généré à partir des données de l'ERP ----------
function fmtQty(i) { return `${num(i.stock, 3)} ${i.unit}`; }

export function buildContext(formulationId) {
  const ings = db.all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name));
  const lab = ings.filter(i => i.category === 'Matériel de laboratoire');
  const mats = ings.filter(i => i.category !== 'Matériel de laboratoire');
  const sup = (id) => db.get('suppliers', id)?.name || '';
  const lines = [];
  lines.push(`# Contexte ERP DermaGen (généré le ${dateFmt(new Date().toISOString().slice(0, 10))})`);
  lines.push('', `## Inventaire des ingrédients (${mats.length})`, 'Nom | Stock restant | INCI | Lot | Péremption | Fournisseur | Notes');
  for (const i of mats) lines.push(`${i.name} | ${fmtQty(i)} | ${i.inci || '—'} | ${i.lot || '—'} | ${i.expiry || '—'} | ${sup(i.supplierId) || '—'} | ${(i.notes || '').slice(0, 140)}`);
  if (lab.length) {
    lines.push('', `## Matériel de laboratoire (${lab.length})`);
    for (const i of lab) lines.push(`- ${i.name} : ${num(i.stock, 0)}`);
  }
  const forms = db.all('formulations').slice().sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  lines.push('', `## Formulations enregistrées (${forms.length})`);
  for (const f of forms) {
    const total = (f.lines || []).reduce((t, l) => t + (Number(l.pct) || 0), 0);
    const comp = (f.lines || []).map(l => { const i = db.get('ingredients', l.ingredientId); return `${l.phase || '?'}:${i ? i.name : '?'} ${num(l.pct, 2)}%`; }).join(', ');
    lines.push(`- ${f.code} — ${f.name} v${f.version || 1} (${f.status}, lot de référence ${num(f.batchSize, 1)} g, total ${num(total, 2)} %) : ${comp}`);
  }
  const f = formulationId ? db.get('formulations', formulationId) : null;
  if (f) {
    lines.push('', `## Formulation sélectionnée pour cette question : ${f.code} — ${f.name} v${f.version || 1}`);
    lines.push(`Statut : ${f.status} · Type : ${f.productType || '—'} · Date : ${f.date || '—'} · Lot de référence : ${num(f.batchSize, 1)} g`);
    if (f.parentCode) lines.push(`Version précédente : ${f.parentCode}`);
    if (f.objective) lines.push(`Objectif : ${f.objective}`);
    lines.push('Composition :', 'Phase | Ingrédient | % | Quantité pour le lot | Rôle | Stock restant');
    for (const l of f.lines || []) { const i = db.get('ingredients', l.ingredientId); lines.push(`${l.phase || '?'} | ${i ? i.name : 'ingrédient supprimé'} | ${num(l.pct, 3)} | ${num((Number(f.batchSize) || 100) * l.pct / 100, 3)} g | ${l.role || ''} | ${i ? fmtQty(i) : '—'}`); }
    if (f.procedure) lines.push(`Mode opératoire : ${f.procedure}`);
    const obs = [['pH', f.ph], ['Viscosité / texture', f.viscosity], ['Aspect / odeur', f.aspect], ['Stabilité', f.stability], ['Résultats', f.result], ['Notes', f.notes]].filter(x => x[1]);
    for (const [k, v] of obs) lines.push(`${k} : ${v}`);
    if ((f.batches || []).length) lines.push(`Lots fabriqués : ${f.batches.map(b => `${b.lot} (${num(b.qty, 0)} g, ${b.date})`).join(' ; ')}`);
  }
  return lines.join('\n');
}

// ---------- Appel de l'API Claude en flux, avec recherche web côté serveur ----------
export function apiConfig() {
  const s = db.settings();
  return { key: (s.anthropicKey || '').trim(), model: s.chatModel || MODELS[0][0], effort: s.chatEffort || 'medium', web: s.chatWeb !== false };
}

const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'CA', city: 'Montreal', region: 'Quebec', timezone: 'America/Toronto' } },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5, max_content_tokens: 20000 },
];
const WEB_NOTE = `Recherche web activée : tu peux chercher sur le web et lire des pages. Utilise-la pour vérifier en direct les seuils réglementaires (Liste critique de Santé Canada, étiquetage, déclaration), les fiches techniques et fiches de données de sécurité des fournisseurs, et les avis récents, en privilégiant les sources officielles listées dans tes références (canada.ca, ec.europa.eu, cir-safety.org, fda.gov, makingcosmetics.com). Cherche seulement quand la question l'exige ; une question de procédé ou de raisonnement se répond sans recherche. Cite tes sources en fin de réponse sous la forme « Sources : » suivie de liens Markdown [titre](url).`;
const MAX_CONTINUATIONS = 3;

async function postStream(key, body, signal) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch (_) {}
    if (res.status === 401) msg = 'Clé API refusée (401). Vérifiez la clé dans Paramètres → Assistante chimiste.';
    if (res.status === 429) msg = 'Limite de requêtes atteinte (429). Réessayez dans quelques secondes.';
    throw new Error(msg);
  }
  return res;
}

/** Lit un flux SSE et reconstruit les blocs de contenu de la réponse. */
async function readStream(res, { onDelta, onEvent, textSoFar }) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  const blocks = []; const partial = {};
  let buf = '', text = textSoFar, stopReason = null, stopDetails = null, usage = null;
  const handle = (ev) => {
    if (ev.type === 'content_block_start') {
      const b = JSON.parse(JSON.stringify(ev.content_block)); blocks[ev.index] = b; partial[ev.index] = '';
      if (b.type === 'text') { b.text = b.text || ''; b.citations = b.citations || []; }
      if (b.type === 'server_tool_use') { onEvent && onEvent({ type: 'tool', name: b.name }); }
      if (b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result') {
        const errorCode = !Array.isArray(b.content) && b.content?.error_code;
        onEvent && onEvent({ type: 'result', name: b.type, count: Array.isArray(b.content) ? b.content.length : 0, error: errorCode || null });
      }
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index]; const d = ev.delta; if (!b || !d) return;
      if (d.type === 'text_delta') { b.text += d.text; text += d.text; onDelta && onDelta(d.text, text); }
      else if (d.type === 'input_json_delta') { partial[ev.index] += d.partial_json || ''; }
      else if (d.type === 'citations_delta' && d.citation) { b.citations.push(d.citation); onEvent && onEvent({ type: 'citation', citation: d.citation }); }
      else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + (d.thinking || ''); }
      else if (d.type === 'signature_delta') { b.signature = d.signature; }
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b?.type === 'server_tool_use') {
        try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : (b.input || {}); } catch (_) { b.input = b.input || {}; }
        onEvent && onEvent({ type: 'tool-input', name: b.name, input: b.input });
      }
    } else if (ev.type === 'message_delta') { stopReason = ev.delta?.stop_reason || stopReason; stopDetails = ev.delta?.stop_details || stopDetails; usage = ev.usage || usage; }
    else if (ev.type === 'error') throw new Error(ev.error?.message || 'Erreur de flux');
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      let ev; try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (_) { continue; }
      handle(ev);
    }
  }
  return { blocks: blocks.filter(Boolean), text, stopReason, stopDetails, usage };
}

/**
 * Envoie la conversation et appelle onDelta(texte) au fil de la réponse ; onEvent reçoit les étapes
 * (recherche, lecture de page, citation). Reprend automatiquement après une pause du serveur.
 * history : [{ role: 'user' | 'assistant', content: string }]
 * Retourne { text, sources, stopReason, usage }.
 */
export async function ask({ history, formulationId, skill = DEFAULT_SKILL, onDelta, onEvent, signal }) {
  const { key, model, effort, web } = apiConfig();
  if (!key) throw new Error('Aucune clé API enregistrée. Ajoutez-la dans Paramètres → Assistante chimiste.');
  const skillText = await loadSkill(skill);
  const system = [
    { type: 'text', text: skillText, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: buildContext(formulationId) },
  ];
  if (web) system.push({ type: 'text', text: WEB_NOTE });
  const baseMessages = history.map(m => ({ role: m.role, content: m.content }));
  const body = { model, max_tokens: 8000, stream: true, thinking: { type: 'adaptive' }, output_config: { effort }, fallbacks: 'default', system, messages: baseMessages };
  if (web) body.tools = WEB_TOOLS;

  let text = '', assistantBlocks = [], stopReason = null, stopDetails = null, usage = null;
  const sources = new Map();
  const collect = (ev) => { if (ev.type === 'citation' && ev.citation?.url) sources.set(ev.citation.url, ev.citation.title || ev.citation.url); onEvent && onEvent(ev); };
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const messages = assistantBlocks.length ? [...baseMessages, { role: 'assistant', content: assistantBlocks }] : baseMessages;
    const res = await postStream(key, { ...body, messages }, signal);
    const r = await readStream(res, { onDelta, onEvent: collect, textSoFar: text });
    text = r.text; assistantBlocks = [...assistantBlocks, ...r.blocks]; stopReason = r.stopReason; stopDetails = r.stopDetails; usage = r.usage || usage;
    if (stopReason !== 'pause_turn') break;
    onEvent && onEvent({ type: 'continue', turn: turn + 1 });
  }
  if (stopReason === 'refusal' && !text) text = 'La réponse a été refusée par les filtres de sécurité' + (stopDetails?.category ? ` (catégorie : ${stopDetails.category})` : '') + '. Reformule la question en précisant le contexte cosmétique.';
  if (stopReason === 'max_tokens') text += '\n\n*(réponse tronquée : limite de longueur atteinte)*';
  if (stopReason === 'pause_turn') text += '\n\n*(recherche interrompue après plusieurs reprises : reformule ou précise la question)*';
  const src = [...sources.entries()];
  if (src.length && !/\n\s*\**Sources\**\s*:/i.test(text)) text += '\n\nSources : ' + src.map(([u, t]) => `[${t.replace(/[\[\]]/g, '')}](${u})`).join(' · ');
  return { text, sources: src, stopReason, usage };
}

// ---------- Rendu Markdown minimal et sûr (échappement avant mise en forme) ----------
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inline(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
}
export function renderMarkdown(md) {
  const lines = escHtml(md).split('\n');
  const out = []; let i = 0;
  const flushPara = (buf) => { if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); };
  let para = [];
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { flushPara(para); para = []; const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push(`<pre>${code.join('\n')}</pre>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flushPara(para); para = []; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { const cells = lines[i].trim().slice(1, -1).split('|').map(c => c.trim()); if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells); i++; }
      if (rows.length) out.push(`<div class="table-wrap"><table><thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { flushPara(para); para = []; const lvl = Math.min(4, h[1].length + 2); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*([-*•])\s+/.test(l)) { flushPara(para); para = []; const items = []; while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, '')); out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { flushPara(para); para = []; const items = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, '')); out.push(`<ol>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
    if (!l.trim()) { flushPara(para); para = []; i++; continue; }
    para.push(l.trim()); i++;
  }
  flushPara(para);
  return out.join('');
}
