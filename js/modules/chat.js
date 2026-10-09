// Assistante chimiste : discussion avec un·e chimiste cosmétique (skill « chimiste-cosmetique »)
// qui connaît l'inventaire et les formulations de l'ERP. Conversations conservées dans le navigateur.
import { db } from '../store.js';
import { esc, toast, confirmDialog, dateFmt } from '../ui.js';
import { ask, apiConfig, renderMarkdown, MODELS, SKILLS, DEFAULT_SKILL, skillInfo } from '../chimiste.js';

const SUGGESTIONS = {
  chimiste: [
    'Je vais fabriquer la Phase Transformante v4 : fais-moi la liste de vérification avant de commencer.',
    'Ai-je assez de stock pour un lot de 500 g de la dernière Phase Transformante ?',
    'Quel pH viser pour le Booster lipidique et comment l’ajuster ?',
    'Comment éviter les grumeaux d’hydroxyethylcellulose ?',
    'Quels tests de stabilité lancer sur l’essai 4 et comment les noter ?',
    'Crée une formulation « Sérum test » de 200 g : eau qsp, glycérine 3 %, panthénol 1 %, phénoxyéthanol 0,8 %, caprylyl glycol 0,5 %.',
  ],
  cosmetologue: [
    'À quel type de cheveu la Phase Transformante v4 convient-elle, et à qui la déconseiller ?',
    'Rédige le protocole d’application en salon du traitement complet : préparateur, phase transformante, booster.',
    'Quelles allégations peut-on écrire sur l’étiquette sans basculer du côté « drogue » au Canada ?',
    'Comment évaluer l’efficacité du lissage et la tolérance avant un test sur clientes ?',
    'Que doit contenir l’étiquette et quand déclarer le produit à Santé Canada ?',
  ],
};

let streaming = null; // AbortController de la réponse en cours

function title(text) { const t = text.trim().replace(/\s+/g, ' '); return t.length > 60 ? t.slice(0, 57) + '…' : t; }

export default {
  title: 'Assistante chimiste',
  render(el, ctx) {
    const chats = db.all('chats').slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const current = ctx.id ? db.get('chats', ctx.id) : null;
    const forms = db.all('formulations').slice().sort((a, b) => (b.code || '').localeCompare(a.code || ''));
    const skillId = (current && current.skill) || sessionStorage.getItem('chat-skill') || DEFAULT_SKILL;
    const sk = skillInfo(skillId);
    const cfg = apiConfig();
    const modelLabel = (MODELS.find(m => m[0] === cfg.model) || [cfg.model, cfg.model])[1];

    el.innerHTML = `
      <div class="chat-layout">
        <aside class="card chat-side">
          <button class="btn primary" data-new-chat style="width:100%;justify-content:center">+ Nouvelle discussion</button>
          <div class="chat-list">
            ${chats.length ? chats.map(c => `<a href="#/chat/${c.id}" class="chat-item ${current && c.id === current.id ? 'active' : ''}"><div class="chat-item-title">${skillInfo(c.skill).icon} ${esc(c.title || 'Sans titre')}</div><div class="muted">${dateFmt((c.updatedAt || '').slice(0, 10))} · ${(c.messages || []).length} message(s)</div></a>`).join('') : '<div class="muted" style="padding:10px 4px">Aucune discussion pour l’instant.</div>'}
          </div>
          <div class="chat-side-foot muted">
            <b>${esc(sk.label)}</b><br>${esc(modelLabel)}<br>
            ${cfg.key ? 'Clé API enregistrée' : '<span class="pct-bad">Clé API manquante</span> · <a href="#/settings">Paramètres</a>'}<br>${cfg.web ? 'Recherche web en direct' : 'Recherche web désactivée'}
          </div>
        </aside>
        <section class="card chat-main">
          <div class="chat-head">
            <div class="chat-avatar">${sk.icon}</div>
            <div class="topbar-text"><div class="strong">${esc(sk.label)}</div><div class="muted">${esc(sk.tagline)} Peut créer une formulation, écrire un mode opératoire et consigner des observations sur demande.</div></div>
            ${current ? '' : `<div class="skill-switch" role="tablist">${Object.values(SKILLS).map(s => `<button type="button" class="skill-tab ${s.id === sk.id ? 'on' : ''}" data-skill="${s.id}" role="tab">${s.icon} ${esc(s.label)}</button>`).join('')}</div>`}
            ${current ? '<button class="btn sm danger" data-del-chat>Supprimer</button>' : ''}
          </div>
          <div class="chat-messages" data-messages>
            ${!current || !(current.messages || []).length ? `
              <div class="chat-welcome">
                <h3>Bonjour ! Sur quoi travailles-tu aujourd’hui ?</h3>
                <p class="muted">${sk.id === 'cosmetologue' ? 'Je regarde tes formules du point de vue du cheveu, de la personne et de l’étiquette.' : 'Je connais ton inventaire, ton matériel et tes formulations.'} Choisis l’interlocuteur en haut à droite, une formulation ci-dessous si ta question la concerne, ou pars d’une suggestion.</p>
                <div class="chat-suggestions">${(SUGGESTIONS[sk.id] || SUGGESTIONS.chimiste).map(s => `<button type="button" class="chip" data-suggest>${esc(s)}</button>`).join('')}</div>
              </div>` : (current.messages || []).map(m => bubble(m, sk)).join('')}
          </div>
          <form class="chat-composer" data-composer>
            <div class="chat-composer-row">
              <select name="formulationId" title="Formulation concernée par la question">
                <option value="">Question générale</option>
                ${forms.map(f => `<option value="${f.id}" ${current && current.formulationId === f.id ? 'selected' : ''}>${esc(f.code)} — ${esc(f.name)} v${f.version || 1}</option>`).join('')}
              </select>
            </div>
            <div class="chat-composer-row">
              <textarea name="text" rows="2" placeholder="Écris ta question… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)" ${cfg.key ? '' : 'disabled'}></textarea>
              <button type="submit" class="chat-send" title="Envoyer" ${cfg.key ? '' : 'disabled'} aria-label="Envoyer">➤</button>
            </div>
            ${cfg.key ? '' : '<div class="warnbox" style="margin:10px 0 0">Pour activer l’assistante, enregistre une clé API Claude dans <a href="#/settings">Paramètres → Assistante chimiste</a>. La clé reste dans ce navigateur.</div>'}
          </form>
        </section>
      </div>`;

    const messagesEl = el.querySelector('[data-messages]');
    const form = el.querySelector('[data-composer]');
    const ta = form.querySelector('[name=text]');
    const scroll = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };
    scroll();

    el.querySelector('[data-new-chat]').addEventListener('click', () => ctx.navigate('chat'));
    el.querySelector('[data-del-chat]')?.addEventListener('click', async () => {
      if (await confirmDialog('Supprimer cette discussion ?', { label: 'Supprimer' })) { db.remove('chats', current.id); ctx.navigate('chat'); }
    });
    el.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => { ta.value = b.textContent; ta.focus(); }));
    el.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => { sessionStorage.setItem('chat-skill', b.dataset.skill); ctx.navigate('chat'); window.dispatchEvent(new HashChangeEvent('hashchange')); }));
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return;
      if (streaming) { toast('Une réponse est déjà en cours.', 'warn'); return; }
      const formulationId = form.querySelector('[name=formulationId]').value || '';
      let chat = current;
      if (!chat) { chat = db.insert('chats', { title: title(text), formulationId, skill: sk.id, messages: [] }); }
      const now = new Date().toISOString();
      const fresh = db.get('chats', chat.id) || chat;   // toujours repartir de l'état enregistré (la réponse précédente y est)
      const messages = [...(fresh.messages || []), { role: 'user', content: text, at: now }];
      db.update('chats', chat.id, { messages, formulationId });
      if (!current) { location.hash = '#/chat/' + chat.id; return sendPending(chat.id, text, formulationId); }
      ta.value = '';
      messagesEl.querySelector('.chat-welcome')?.remove();
      messagesEl.insertAdjacentHTML('beforeend', bubble({ role: 'user', content: text, at: now }, sk));
      await respond(chat.id, messages, formulationId, messagesEl, scroll, form, sk);
    });

    // Première question d'une nouvelle discussion : la page est re-rendue avec l'id, puis on répond.
    const pending = sessionStorage.getItem('chat-pending');
    if (current && pending) {
      try { const p = JSON.parse(pending); if (p.id === current.id) { sessionStorage.removeItem('chat-pending'); respond(current.id, current.messages, p.formulationId, messagesEl, scroll, form, sk); } } catch (_) { sessionStorage.removeItem('chat-pending'); }
    }
  }
};

function sendPending(id, text, formulationId) { sessionStorage.setItem('chat-pending', JSON.stringify({ id, text, formulationId })); }

function bubble(m, sk) {
  const t = m.at ? new Date(m.at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
  if (m.role === 'user') return `<div class="msg user"><div class="msg-body">${esc(m.content)}</div><div class="msg-time">${t}</div></div>`;
  return `<div class="msg assistant"><div class="msg-avatar">${(sk || skillInfo()).icon}</div><div><div class="msg-body md">${renderMarkdown(m.content)}</div><div class="msg-time">${t}</div></div></div>`;
}

async function respond(chatId, messages, formulationId, messagesEl, scroll, form, sk) {
  sk = sk || skillInfo();
  const ta = form.querySelector('[name=text]'), send = form.querySelector('.chat-send');
  const holder = document.createElement('div');
  holder.className = 'msg assistant';
  holder.innerHTML = `<div class="msg-avatar">${sk.icon}</div><div><div class="msg-body md"><span class="typing"><i></i><i></i><i></i></span></div><div class="msg-status" data-status hidden></div><div class="msg-time"></div></div>`;
  messagesEl.appendChild(holder); scroll();
  const body = holder.querySelector('.msg-body'), status = holder.querySelector('[data-status]');
  const setStatus = (t) => { status.textContent = t; status.hidden = !t; scroll(); };
  send.textContent = '■'; send.title = 'Arrêter'; ta.disabled = true;
  streaming = new AbortController();
  const stop = () => streaming && streaming.abort();
  send.addEventListener('click', stop, { once: true });
  let full = '';
  try {
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const r = await ask({ history, formulationId, skill: sk.id, tools: true, signal: streaming.signal,
      onDelta: (_, acc) => { full = acc; body.innerHTML = renderMarkdown(acc); scroll(); },
      onEvent: (ev) => {
        if (ev.type === 'tool-input') setStatus(ev.name === 'web_fetch' ? `Lecture de la page ${ev.input?.url || ''}` : `Recherche web : « ${ev.input?.query || ''} »`);
        else if (ev.type === 'result') setStatus(ev.error ? `Recherche impossible (${ev.error})` : ev.name === 'web_fetch_tool_result' ? 'Page lue, rédaction en cours…' : `${ev.count} résultat(s), analyse en cours…`);
        else if (ev.type === 'continue') setStatus('Recherche approfondie, reprise…');
        else if (ev.type === 'tool-call') setStatus({ creer_formulation: 'Création de la formulation…', definir_etapes: 'Écriture du mode opératoire…', enregistrer_observations: 'Enregistrement des observations…' }[ev.name] || 'Action dans l’ERP…');
      } });
    setStatus('');
    full = r.text || full;
    body.innerHTML = renderMarkdown(full);
  } catch (e) {
    if (e.name === 'AbortError') { full = full || '*(réponse interrompue)*'; body.innerHTML = renderMarkdown(full); }
    else { body.innerHTML = `<div class="warnbox" style="margin:0">${esc(e.message || 'Erreur')}</div>`; full = ''; }
  } finally {
    send.removeEventListener('click', stop);
    streaming = null; send.textContent = '➤'; send.title = 'Envoyer'; ta.disabled = false; ta.focus();
    holder.querySelector('.msg-time').textContent = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    if (full) {
      const chat = db.get('chats', chatId);
      if (chat) db.update('chats', chatId, { messages: [...(chat.messages || []), { role: 'assistant', content: full, at: new Date().toISOString() }] });
    }
    scroll();
  }
}
