// Connexion à la base en ligne (Supabase). Laisser vide = mode local (données dans ce navigateur seulement).
// La clé « anon » est publique par conception : la sécurité repose sur l'authentification et les règles RLS
// de la base (voir supabase/schema.sql). Ne jamais mettre ici la clé « service_role ».
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
export const cloudEnabled = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY) || !!globalThis.__supabaseMock;
