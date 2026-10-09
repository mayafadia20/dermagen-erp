-- ERP DermaGen — schéma Supabase (à exécuter une fois dans SQL Editor du projet).
-- Toutes les collections de l'application (ingrédients, formulations, fiches, discussions, comptes…)
-- sont stockées dans une seule table de documents JSON, réservée aux utilisateurs authentifiés.

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

-- Sécurité : seules les personnes connectées (l'équipe DermaGen) lisent et écrivent.
alter table public.records enable row level security;
drop policy if exists "equipe_lecture"      on public.records;
drop policy if exists "equipe_insertion"    on public.records;
drop policy if exists "equipe_modification" on public.records;
drop policy if exists "equipe_suppression"  on public.records;
create policy "equipe_lecture"      on public.records for select to authenticated using (true);
create policy "equipe_insertion"    on public.records for insert to authenticated with check (true);
create policy "equipe_modification" on public.records for update to authenticated using (true) with check (true);
create policy "equipe_suppression"  on public.records for delete to authenticated using (true);

-- Temps réel : les autres postes voient les changements sans recharger.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
