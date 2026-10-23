-- =====================================================================
-- SOLO PARA DESARROLLO Y PRUEBAS LOCALES con PostgreSQL "puro".
-- Recrea los objetos mínimos que Supabase ya trae (roles anon/authenticated/
-- service_role y la tabla auth.users) para que las migraciones corran igual
-- que en Supabase. NO ejecutar en un proyecto de Supabase.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated;
-- Supabase otorga por defecto privilegios amplios a anon/authenticated en public;
-- los replicamos para comprobar que la migración de seguridad los revoca.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
