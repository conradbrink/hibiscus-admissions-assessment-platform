# Database schema

Nine migrations, replayable from an empty database. That last property is not
decorative: the sibling project discovered its history was *not* replayable
at the exact moment it was rebuilding production. `tests/replay_local.sh`
rehearses the rebuild and runs the security suite; run it after every schema
change.

## Layout

| Migration | What |
|---|---|
| `…120000_staff_and_permissions` | Staff, roles, permissions, `has_permission()`, `my_permissions()`, audit log, seeded roles |
| `…120100_reference_data` | Campuses, grades, campus × grade matrix, academic years, intakes, settings, campus scoping; seeded from the current website |
| `…120200_applications` | Contacts, reference numbering, applications, guardians, timeline, tasks, notes; column grants that keep `status` off-limits to staff |
| `…120300_access_tokens` | Magic-link tokens (hash only), `consume_token()`, rate limiter |
| `…120400_scheduling` | Sessions, bookings, `book_session()` with capacity under lock, callback requests |
| `…120500_communications` | Email templates (versioned), messages log, `publish_email_template()`, seeded Phase 1 templates |
| `…120600_jobs` | The job outbox and `claim_jobs()` |
| `…120700_funnel_events` | Parent-effort instrumentation and the analytics views |
| `…120800_workflow_engine` | `commit_transition()`, `create_application()`, `dashboard_counts()` |

## Rules for new migrations

1. **Filename `YYYYMMDDHHMMSS_snake_case.sql`**, and once a migration has been
   applied anywhere its filename must equal the version the database recorded.
   Never invent the timestamp after the fact. CI checks the shape and refuses
   edits to files already on `main`.
2. **Never edit an applied migration.** Add a new one. The nine here are
   editable only until the first project applies them.
3. **`security invoker` on every RPC and `security_invoker = true` on every
   view.** A view defaults to definer rights and bypasses RLS. The only
   `security definer` functions are the RLS helpers that read `staff_*`
   tables, and each pins `search_path`.
4. **Wrap auth calls in policies as `(select …)`** — `(select auth.uid())`,
   `(select public.has_permission('x'))` — so they evaluate once per query.
5. **Revoke EXECUTE from `public, anon`** on every function, and from
   `authenticated` too unless staff genuinely call it from the browser.
   Postgres grants EXECUTE to PUBLIC by default; revoking only from `anon`
   changes nothing.
6. **A missing policy is a decision and gets a comment.** `audit_log` has no
   update or delete policy; `bookings` has no write policy for staff; these
   are on purpose and say so.
7. Idempotent DDL: `create table if not exists`, `drop policy if exists`
   before `create policy`, `drop trigger if exists` before `create trigger`.

## Applying to a project

```sh
npm i -g supabase
supabase link --project-ref <ref>
supabase db push
supabase migration list        # every file should show as applied
```

## The first super administrator

Accounts are created by administrators, and there is no administrator until
one exists. Bootstrap once, in the project's SQL editor:

```sql
-- 1. Create the auth user in Authentication → Users (invite by email), then:
insert into public.staff_profiles (id, full_name, email)
values ('<auth user id>', 'Full Name', 'email@school.example');

insert into public.staff_roles (staff_id, role_id)
select '<auth user id>', id from public.roles where code = 'super_admin';
```

From then on, Staff & roles in the console does it.

## Local rehearsal

```sh
su postgres -c "supabase/tests/replay_local.sh"
```

Creates `hibiscus_local` from scratch on a stock Ubuntu Postgres, applies
`tests/local_supabase_stub.sql` (roles, `auth.uid()`), every migration in
order, then `tests/security_regression.sql`. Exit code 0 means both "the
schema builds" and "the schema refuses what it should".
