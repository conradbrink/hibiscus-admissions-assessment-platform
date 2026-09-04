-- Enough of Supabase's environment to replay the migrations on a plain
-- Postgres — the roles, the `auth` schema, and `auth.uid()`.
--
-- Used by replay_local.sh. Never applied to a real Supabase project, where
-- all of this already exists.
--
-- `auth.uid()` is implemented exactly as Supabase implements it, reading the
-- `sub` claim from `request.jwt.claims`, so a test can impersonate a member
-- of staff with:
--
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    ),
    ''
  )
$$;

-- Supabase's default grants: the API roles may use the public schema, and
-- get table privileges on new tables (RLS is what gates them). service_role
-- gets everything and bypasses RLS.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
