// Connexion à la base en ligne (Supabase). Laisser vide = mode local (données dans ce navigateur seulement).
// La clé « anon » est publique par conception : la sécurité repose sur l'authentification et les règles RLS
// de la base (voir supabase/schema.sql). Ne jamais mettre ici la clé « service_role ».
export const SUPABASE_URL = 'https://prsjvuepdimlfpwykque.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByc2p2dWVwZGltbGZwd3lrcXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjE1ODYsImV4cCI6MjEwNzEzNzU4Nn0.U2-zjpZht3F9QnzxhXIMHRcV7-f93LBHrdw30bk-ynk';
export const cloudEnabled = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY) || !!globalThis.__supabaseMock;
