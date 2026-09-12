-- Three findings from the security audit, all at the database's edge.
--
-- None of them is known to be reachable today. Each is a control that was
-- being held up by another control rather than standing on its own, which is
-- the kind of thing that stops being true quietly.

-- ---------------------------------------------------------------------------
-- 1. pg_net: what we can hold, and what we cannot
-- ---------------------------------------------------------------------------

-- `net.http_get`, `net.http_post` and `net.http_delete` make the database
-- itself issue an HTTP request. They exist here for one job: the five-minute
-- `drain_tick`, which runs as `postgres` under pg_cron and reads its bearer
-- token from Vault.
--
-- Both `anon` — the key that ships inside the browser bundle, by design — and
-- `authenticated` hold EXECUTE on all three. That grant is Supabase's, not
-- ours: the `net` schema and its functions are owned by `supabase_admin`, and
-- `postgres` is not a member, so a `revoke` from a migration reports "no
-- privileges could be revoked" and changes nothing. Written out here so the
-- next person does not spend the afternoon discovering that again.
--
-- What actually keeps it unreachable is the PostgREST schema list: only
-- `public` and `graphql_public` are exposed, so there is no route to
-- `net.http_post` from the internet. Verified against the live API, which
-- answers a request for the `net` schema with
-- "Only the following schemas are exposed: public, graphql_public".
--
-- So the invariant this migration can hold, and case 59 asserts, is the one
-- on our side of that line: **no function in `public` may hand pg_net to
-- anybody**. `drain_tick` calls it and is executable by nobody but the job
-- owner. A future wrapper that forgot to revoke would be the bridge across
-- the boundary, and the suite now fails the moment one exists.
--
-- Two things for the school's checklist rather than for SQL:
--   * Dashboard → Settings → API → Exposed schemas must stay
--     `public, graphql_public`.
--   * Supabase support can revoke the grant itself if they are asked to.

revoke all on function public.drain_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Eight trigger functions anybody could call
-- ---------------------------------------------------------------------------

-- Most trigger functions in this schema are revoked from `public, anon,
-- authenticated` in the same statement that creates them. Eight were not, so
-- Supabase's default grant left them callable — including by `anon`, and
-- including the guard added yesterday that decides whether somebody may set
-- their own `is_active`.
--
-- Calling a trigger function directly raises "can only be called as a
-- trigger" and does nothing, which is exactly why it went unnoticed for so
-- long. The rule is worth keeping whole: a function that exists to be fired
-- by a trigger has no business being in anybody's API surface.
--
-- Written as a sweep rather than a list of names because that is the shape of
-- the rule, and because a list is one `create function` away from being out
-- of date again. Case 59 of the security suite asserts the same sweep finds
-- nothing.
do $$
declare
  v_fn text;
begin
  for v_fn in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and t.typname = 'trigger'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Three functions with a search path somebody else could choose
-- ---------------------------------------------------------------------------

-- A function without `set search_path` resolves its unqualified names using
-- whatever the *caller's* search path happens to be. These three are triggers
-- on money and on the catalogue — they set a payment's subject and an item's
-- currency — and they look up `public` tables without saying so.
--
-- Pinning the path costs nothing and removes the whole class: a schema
-- planted earlier in somebody's search path can no longer answer for
-- `payments`, `applications` or `campuses`.
alter function public.optional_items_set_currency() set search_path = public, pg_temp;
alter function public.payment_requests_set_subject() set search_path = public, pg_temp;
alter function public.payments_set_subject() set search_path = public, pg_temp;
