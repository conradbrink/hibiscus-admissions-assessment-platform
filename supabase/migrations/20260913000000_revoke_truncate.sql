-- TRUNCATE is the one write row-level security does not govern.
--
-- RLS filters rows for select, insert, update and delete. It has nothing to
-- say about `truncate table`, which is a DDL-flavoured command checked only
-- against the table privilege — so a role holding TRUNCATE empties a table
-- whatever the policies say. On this database `anon` and `authenticated` held
-- it on 91 of 92 tables in `public`, which is Supabase's default `grant all`
-- and not a decision anybody here made.
--
-- The two tables where that matters most are the ones you need *after* an
-- incident rather than during it: `audit_log` and `application_events`. Both
-- are deliberately append-only from any staff client — they carry a select
-- policy and no insert, update or delete policy at all, so a signed-in person
-- cannot add to them, change them or remove a row. TRUNCATE would have taken
-- the lot, and left no trace of having done so.
--
-- Not reachable today, and it is worth writing down why, because the reason
-- is somebody else's implementation detail rather than an invariant of ours:
-- PostgREST is the only thing that ever acts as `anon` or `authenticated`,
-- it maps HTTP verbs onto select/insert/update/delete, and it has no verb
-- that emits TRUNCATE. Both roles are NOLOGIN, so nothing else connects as
-- them. What would make it reachable is one `security invoker` function that
-- truncates something and is callable over RPC — the same shape as the pg_net
-- wrapper that `20260912230000_security_hardening.sql` guards against.
--
-- So: take the privilege away, since nothing in this system has ever used it.
--
-- `REFERENCES` is granted just as widely and is left alone deliberately: it
-- only permits creating a foreign key that points at the table, and neither
-- role holds CREATE on the schema, so there is nowhere to put one.

revoke truncate on all tables in schema public from anon, authenticated;

-- The same grant arrives with every new table, so revoking once would fix
-- today and nothing after it. Default privileges are per creating role: our
-- migrations run as `postgres`, and this covers what they create from here on.
--
-- The parallel entry owned by `supabase_admin` cannot be altered from here —
-- `postgres` is not a member of it, exactly as with the `net` schema — so a
-- table created by Supabase itself would still arrive with TRUNCATE granted.
-- That is why case 61 of the security suite asserts the invariant over every
-- table rather than trusting this statement to have covered them all.
alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;
