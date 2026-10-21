-- ERP DermaGen — schéma Supabase (à exécuter une fois dans SQL Editor du projet).
-- Toutes les collections de l'application (ingrédients, formulations, fiches, discussions, comptes…)
-- sont stockées dans une seule table de documents JSON, réservée aux comptes dont le courriel figure
-- dans la liste des accès autorisés (table acces_autorises, plus bas). Le script peut être réexécuté sans risque.

create table if not exists public.records (
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid(),
  primary key (collection, id)
);
create index if not exists records_collection_idx on public.records (collection);

-- updated_at / updated_by tenus à jour automatiquement
create or replace function public.records_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- Sécurité : la table est protégée par RLS ; les règles sont définies plus bas (section « Accès réservé »)
-- et ne laissent lire et écrire que les comptes dont le courriel figure dans la liste des accès autorisés.
alter table public.records enable row level security;

-- Temps réel : les autres postes voient les changements sans recharger.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Accès réservé : liste des courriels autorisés.
-- Seules ces adresses peuvent créer un compte (déclencheur sur auth.users) et lire ou écrire
-- les données (règles RLS). Les comptes qui existent déjà au moment où ce script est exécuté
-- sont ajoutés automatiquement à la liste. Vérifier ensuite :
--     select * from public.acces_autorises;
-- et retirer une adresse au besoin :
--     delete from public.acces_autorises where email = 'adresse@exemple.ca';
-- Depuis l'ERP, « Nouvel utilisateur » (profil administrateur) ajoute l'adresse à la liste
-- avant de créer le compte.
create table if not exists public.acces_autorises (
  email      text        primary key check (email = lower(email)),
  ajoute_le  timestamptz not null default now(),
  ajoute_par uuid        default auth.uid()
);
insert into public.acces_autorises (email)
  select lower(email) from auth.users where email is not null
  on conflict (email) do nothing;

-- Vrai si le courriel de la personne connectée figure dans la liste.
create or replace function public.est_autorise() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.acces_autorises a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.est_autorise() from public;
grant execute on function public.est_autorise() to authenticated, service_role;

-- Toute inscription (formulaire, API avec la clé anon, invitation) est refusée hors liste.
create or replace function public.inscription_reservee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or not exists (select 1 from public.acces_autorises a where a.email = lower(new.email)) then
    raise exception 'Inscription refusée : % n''est pas dans la liste des accès autorisés.', coalesce(new.email, '(sans courriel)');
  end if;
  return new;
end $$;
drop trigger if exists inscription_reservee on auth.users;
create trigger inscription_reservee before insert on auth.users
  for each row execute function public.inscription_reservee();

-- La liste elle-même : lisible et modifiable par les personnes autorisées (pas de suppression de sa propre adresse).
alter table public.acces_autorises enable row level security;
drop policy if exists "acces_lecture" on public.acces_autorises;
drop policy if exists "acces_ajout"   on public.acces_autorises;
drop policy if exists "acces_retrait" on public.acces_autorises;
create policy "acces_lecture" on public.acces_autorises for select to authenticated using (public.est_autorise());
create policy "acces_ajout"   on public.acces_autorises for insert to authenticated with check (public.est_autorise());
create policy "acces_retrait" on public.acces_autorises for delete to authenticated
  using (public.est_autorise() and email <> lower(coalesce(auth.jwt() ->> 'email', '')));

-- Les données ne sont plus ouvertes à tout compte connecté, seulement aux adresses de la liste.
drop policy if exists "equipe_lecture"      on public.records;
drop policy if exists "equipe_insertion"    on public.records;
drop policy if exists "equipe_modification" on public.records;
drop policy if exists "equipe_suppression"  on public.records;
create policy "equipe_lecture"      on public.records for select to authenticated using (public.est_autorise());
create policy "equipe_insertion"    on public.records for insert to authenticated with check (public.est_autorise());
create policy "equipe_modification" on public.records for update to authenticated using (public.est_autorise()) with check (public.est_autorise());
create policy "equipe_suppression"  on public.records for delete to authenticated using (public.est_autorise());
