// Simulation de Supabase pour les tests automatisés (jamais chargée en production).
// Données partagées entre onglets via localStorage ; temps réel simulé par l'événement « storage ».
(function () {
  const KEY = 'mock-supabase-records', USERS = 'mock-supabase-users';
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const SESSION = 'mock-supabase-session';
  globalThis.__supabaseMock = function createClient(url, key, opts = {}) {
    const persist = opts.auth?.persistSession !== false;
    let session = persist ? JSON.parse(sessionStorage.getItem(SESSION) || 'null') : null;
    const listeners = [];
    const setSession = (s) => { session = s; if (persist) { if (s) sessionStorage.setItem(SESSION, JSON.stringify(s)); else sessionStorage.removeItem(SESSION); } listeners.forEach(fn => fn(s ? 'SIGNED_IN' : 'SIGNED_OUT', s)); };
    const requireAuth = () => { if (!session) return { message: 'JWT manquant (non connecté)' }; return null; };
    const auth = {
      async getSession() { return { data: { session } }; },
      async signInWithPassword({ email, password }) {
        const u = read(USERS).find(x => x.email === email.toLowerCase());
        if (!u || u.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
        const s = { user: { id: u.id, email: u.email, user_metadata: u.meta }, access_token: 't' }; if (persist) setSession(s); return { data: s, error: null };
      },
      async signUp({ email, password, options }) {
        const users = read(USERS); email = email.toLowerCase();
        if (users.some(x => x.email === email)) return { data: {}, error: { message: 'User already registered' } };
        const u = { id: 'uid-' + Math.random().toString(36).slice(2, 10), email, password, meta: options?.data || {} }; users.push(u); write(USERS, users);
        const user = { id: u.id, email, user_metadata: u.meta }; const s = { user, access_token: 't' };
        if (persist) setSession(s);
        return { data: { user, session: persist ? s : null }, error: null };
      },
      async signOut() { setSession(null); return { error: null }; },
      async updateUser({ password }) { if (!session) return { error: { message: 'non connecté' } }; const users = read(USERS); const u = users.find(x => x.id === session.user.id); if (u) { u.password = password; write(USERS, users); } return { data: {}, error: null }; },
      async resetPasswordForEmail(email) { localStorage.setItem('mock-reset-sent', email); return { error: null }; },
      onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    };
    const table = () => ({
      select() { const e = requireAuth(); return Promise.resolve(e ? { data: null, error: e } : { data: read(KEY), error: null }); },
      upsert(rows) { const e = requireAuth(); if (e) return Promise.resolve({ error: e }); const all = read(KEY); for (const r of rows) { const i = all.findIndex(x => x.collection === r.collection && x.id === r.id); const row = { collection: r.collection, id: r.id, data: r.data, updated_at: new Date().toISOString() }; if (i >= 0) all[i] = row; else all.push(row); } write(KEY, all); localStorage.setItem('mock-rt', JSON.stringify({ t: Date.now(), rows: rows.map(r => ({ type: 'upsert', ...r })) })); return Promise.resolve({ error: null }); },
      delete() {
        const filters = [];
        const q = { eq(k, v) { filters.push(x => x[k] === v); return q; }, neq(k, v) { filters.push(x => x[k] !== v); return q; },
          then(res) { const e = requireAuth(); if (e) return res({ error: e }); const all = read(KEY); const gone = all.filter(x => filters.every(f => f(x))); write(KEY, all.filter(x => !gone.includes(x))); localStorage.setItem('mock-rt', JSON.stringify({ t: Date.now(), rows: gone.map(r => ({ type: 'delete', collection: r.collection, id: r.id })) })); return res({ error: null }); } };
        return q;
      },
    });
    const client = {
      auth,
      from() { return table(); },
      channel() { let cb = null; const h = (e) => { if (e.key !== 'mock-rt' || !cb) return; const p = JSON.parse(e.newValue); for (const r of p.rows) cb({ eventType: r.type === 'delete' ? 'DELETE' : 'UPDATE', new: r.type === 'delete' ? null : { collection: r.collection, id: r.id, data: r.data }, old: { collection: r.collection, id: r.id } }); };
        return { on(_t, _f, fn) { cb = fn; return this; }, subscribe() { addEventListener('storage', h); this._h = h; return this; } }; },
      removeChannel(ch) { removeEventListener('storage', ch._h); },
    };
    return client;
  };
})();
