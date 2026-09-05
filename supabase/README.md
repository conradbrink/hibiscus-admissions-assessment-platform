# Database schema

Twenty-two migrations, replayable from an empty database. That last property is not
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
| `…193000_phase2_reference` | Potch → ZA/ZAR, `campus_grades.capacity`, subjects and competencies, Phase 2 settings and email templates |
| `…193100_assessment_bank` | Question banks, passages, rubrics, questions, options, **answer keys (authors only)**, assessment templates and sections, benchmarks |
| `…193200_assessment_delivery` | Frozen forms and their keys, attempts, kiosk codes, responses, scores; `launch_attempt()`, `start_attempt()`, `record_response()`, `submit_attempt()` — service role only |
| `…193300_admissions_decisions` | Rulesets and rules with freeze triggers, `activate_ruleset()`, append-only `admission_decisions`, learning profiles |
| `…193400_offers` | Fee schedules and lines, versioned offer templates with `publish_offer_template()`, offers; replaces `dashboard_counts()` |
| `…210000_campus_scope_hardening` | `roles.campus_scoped`, `can_access_campus()` fails closed, `v_accessible_campuses`, scoped `audit_log` |
| `…210100_acceptance_and_payments` | Offer acceptances, payment requests, payments, bank instructions; payment settings and templates |
| `…210200_registration` | Registrations, contacts, document requirements with `required_document_codes()`, documents, agreement templates with `publish_agreement_template()`, acceptances |
| `…210300_enrolment` | Student records, `dashboard_counts()` with the Phase 3 queues, the welcome template |
| `…100000_messaging` (2026-09-05) | WhatsApp opt-in on contacts, `message_templates`, `messages` (both directions), the `whatsapp_enabled` switch |
| `…100100_documents_and_summaries` | Extraction columns on documents, `registrations.mismatch_flags`, `application_summaries`, the extraction and summary switches, the `document_mismatch` template |
| `…100200_export_and_analytics` | `export_columns` (seeded, medical off), `student_exports`, `mark_student_records_exported()`, prefill counters, `v_application_facts` |
| `…100300_automation` | Retention columns and `anonymise_application()`, `staff_profiles.digest_enabled`, staff-audience templates, `campus_dashboard_counts()`, `maintenance_runs`, the automation settings and templates; replaces `dashboard_counts()` |

## Rules for new migrations

1. **Filename `YYYYMMDDHHMMSS_snake_case.sql`**, and once a migration has been
   applied anywhere its filename must equal the version the database recorded.
   Never invent the timestamp after the fact. CI checks the shape and refuses
   edits to files already on `main`.
2. **Never edit an applied migration.** Add a new one. The twenty-two here are
   editable only until the first project applies them.
3. **`security invoker` on every RPC and `security_invoker = true` on every
   view.** A view defaults to definer rights and bypasses RLS. The
   `security definer` functions are the RLS helpers that read `staff_*`
   tables and, from Phase 4, three the service role alone may call
   (`anonymise_application`, `campus_dashboard_counts`,
   `mark_student_records_exported`) — EXECUTE revoked from `authenticated`
   too, and the suite checks it. Each pins `search_path`.
4. **Wrap auth calls in policies as `(select …)`** — `(select auth.uid())`,
   `(select public.has_permission('x'))` — so they evaluate once per query.
5. **Revoke EXECUTE from `public, anon`** on every function, and from
   `authenticated` too unless staff genuinely call it from the browser.
   Postgres grants EXECUTE to PUBLIC by default; revoking only from `anon`
   changes nothing.
6. **A missing policy is a decision and gets a comment.** `audit_log` has no
   update or delete policy; `bookings` has no write policy for staff; these
   are on purpose and say so.
7. **Nothing references `storage.*`.** The local replay stub has no storage
   schema, and the documents bucket needs no policies because only the
   service role touches it; the application creates the bucket at first use.
8. Idempotent DDL: `create table if not exists`, `drop policy if exists`
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

## Development seed

`seed/dev_phase2.sql` is not a migration and the replay ignores it. It adds a
sample question bank (flagged `is_sample`), a template for the Stage 1–6
band, a Block 7 fee schedule with placeholder amounts and a draft ruleset,
so the assessment → decision → offer journey can be walked on a laptop. It
refuses to run on a database that already holds a real bank.

## Local rehearsal

```sh
su postgres -c "supabase/tests/replay_local.sh"
```

Creates `hibiscus_local` from scratch on a stock Ubuntu Postgres, applies
`tests/local_supabase_stub.sql` (roles, `auth.uid()`), every migration in
order, then `tests/security_regression.sql` (40 attacks, each with a control
that the legitimate case still works). Exit code 0 means both "the schema
builds" and "the schema refuses what it should".
