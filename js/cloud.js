// Accès à Supabase : authentification, lecture/écriture de la table « records » et temps réel.
// Chaque collection de l'ERP est stockée sous forme de lignes (collection, id, data jsonb).
import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from './config.js';

const TABLE = 'records';
let client = null, lib = null;

async function loadLib() {
  if (lib) return lib;
  if (globalThis.__supabaseMock) { lib = { createClient: globalThis.__supabaseMock }; return lib; }
  lib = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  return lib;
}
export async function getClient() {
  if (!cloudEnabled()) return null;
  if (client) return client;
  const { createClient } = await loadLib();
  client = createClient(SUPABASE_URL || 'mock', SUPABASE_ANON_KEY || 'mock', { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
/** Client secondaire sans session : sert à créer un compte pour quelqu'un d'autre sans perdre la sienne. */
export async function getSecondaryClient() {
  const { createClient } = await loadLib();
  return createClient(SUPABASE_URL || 'mock', SUPABASE_ANON_KEY || 'mock', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

const fail = (error, what) => { const e = new Error(`${what} : ${error.message || error}`); e.cause = error; throw e; };

export const cloud = {
  enabled: cloudEnabled,
  region: () => { const m = /https?:\/\/([a-z0-9-]+)\.supabase\.co/.exec(SUPABASE_URL || ''); return m ? m[1] : (globalThis.__supabaseMock ? 'simulation' : ''); },

  // ---- Authentification ----
  async session() { const c = await getClient(); const { data } = await c.auth.getSession(); return data?.session || null; },
  async signIn(email, password) { const c = await getClient(); const { data, error } = await c.auth.signInWithPassword({ email, password }); if (error) fail(error, 'Connexion refusée'); return data.user; },
  async signUpOther(email, password, meta = {}) { const c = await getSecondaryClient(); const { data, error } = await c.auth.signUp({ email, password, options: { data: meta } }); if (error) fail(error, 'Création du compte impossible'); return data; },
  async signOut() { const c = await getClient(); await c.auth.signOut(); },
  async updatePassword(password) { const c = await getClient(); const { error } = await c.auth.updateUser({ password }); if (error) fail(error, 'Changement de mot de passe impossible'); },
  async resetPassword(email) { const c = await getClient(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) fail(error, 'Envoi du courriel impossible'); },
  async onAuth(cb) { const c = await getClient(); return c.auth.onAuthStateChange((event, session) => cb(event, session)); },

  // ---- Accès réservé (liste des courriels autorisés, voir supabase/schema.sql) ----
  /** true/false selon la liste ; null si la base n'a pas encore la fonction (schéma pas à jour). */
  async accessAllowed() {
    const c = await getClient();
    const { data, error } = await c.rpc('est_autorise');
    if (error) {
      if (/est_autorise|PGRST202|42883/.test(`${error.code || ''} ${error.message || ''}`)) { console.warn('Liste des accès absente de la base : exécuter supabase/schema.sql dans Supabase.'); return null; }
      fail(error, 'Vérification de l’accès impossible');
    }
    return data === true;
  },
  /** Ajoute un courriel à la liste des accès (à faire avant de créer le compte de la personne). */
  async allowEmail(email) {
    const c = await getClient();
    const { error } = await c.from('acces_autorises').upsert({ email: String(email || '').trim().toLowerCase() }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) fail(error, 'Ajout à la liste des accès impossible');
  },

  // ---- Données ----
  async loadAll() {
    const c = await getClient();
    const { data, error } = await c.from(TABLE).select('collection,id,data,updated_at');
    if (error) fail(error, 'Lecture de la base en ligne impossible');
    const out = {};
    for (const row of data || []) { (out[row.collection] = out[row.collection] || []).push(row.data); }
    return out;
  },
  async upsert(rows) {   // rows : [{ collection, id, data }]
    if (!rows.length) return;
    const c = await getClient();
    const { error } = await c.from(TABLE).upsert(rows.map(r => ({ collection: r.collection, id: r.id, data: r.data, updated_at: new Date().toISOString() })), { onConflict: 'collection,id' });
    if (error) fail(error, 'Enregistrement en ligne impossible');
  },
  async remove(collection, id) {
    const c = await getClient();
    const { error } = await c.from(TABLE).delete().eq('collection', collection).eq('id', id);
    if (error) fail(error, 'Suppression en ligne impossible');
  },
  async removeAll() {
    const c = await getClient();
    const { error } = await c.from(TABLE).delete().neq('id', '');
    if (error) fail(error, 'Effacement en ligne impossible');
  },
  async subscribe(onChange) {   // onChange({ type: 'upsert'|'delete', collection, id, data })
    const c = await getClient();
    const ch = c.channel('erp-records')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, payload => {
        const row = payload.new && payload.new.id ? payload.new : payload.old;
        if (!row) return;
        onChange({ type: payload.eventType === 'DELETE' ? 'delete' : 'upsert', collection: row.collection, id: row.id, data: payload.new?.data });
      })
      .subscribe();
    return () => c.removeChannel(ch);
  },
};
