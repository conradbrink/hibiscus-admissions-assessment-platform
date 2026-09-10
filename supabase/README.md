# Database schema

Fifty-nine migrations, replayable from an empty database. That last property is not
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
| `…100400_agreement_documents` | `agreement_templates.document_url`, `publish_agreement_template()` with the link, the two published agreements seeded, placeholders retired |
| `…100300_automation` | Retention columns and `anonymise_application()`, `staff_profiles.digest_enabled`, staff-audience templates, `campus_dashboard_counts()`, `maintenance_runs`, the automation settings and templates; replaces `dashboard_counts()` |
| `…123000_ai_marking` (7 Sep) | `marking_method` may be `ai`; the `ai_auto_mark_enabled` switch |
| `…150000_school_name` (7 Sep) | Data only: every template a parent reads says Hibiscus International Schools; agreements already signed keep their text |
| `…220000_campus_signatures` (7 Sep) | `campuses.head_name`, `head_title`, `signature_data_url`: who signs each campus's offer letter, with the signature held inline as a small data URL |
| `…160000_offer_letter` (7 Sep) | Data only: offer template v2 in the school's own words (with `bank_details`), campus addresses and phones for the letterhead, the BWP account details |
| `…210000_venue_in_booking_messages` (7 Sep) | Data only: the booking confirmation, both reminders and the visit confirmation print the campus address and phone lines (`campus_address`), in plain English |
| `…200000_heard_from_and_withdrawn` (7 Sep) | `applications.heard_from` (+ detail) for "How did you hear about us?", `create_application` takes it, `v_application_facts` exposes it, `dashboard_counts()` adds `visits_booked` and `withdrawn` |
| `…20260908020000_registration_received` (8 Sep) | Data only: the `registration_received` email (sent on every submission, naming what is outstanding or saying all is in) and the `documents_reminder_days` setting (2) |
| `…20260908010000_offer_conditions_wording` (8 Sep) | Data only: offer letter v6 words the conditions paragraph as conditions of the place and the terms say a condition can withdraw it |
| `…20260908000000_promotions` (8 Sep) | `promotions`, `promotion_effects`, `application_promotions`; `applications.promo_code`; `offers.promotion_id`; a zero-amount payment request and a `waived` payment (provider `none`) for a fully waived offer; `v_application_facts` gains `promotion_code`/`promotion_name`; offer template v5 and results email print the deal; new `fees_waived` email |
| `…230000_paygate` (7 Sep) | `payments.provider` accepts `paygate`, the school's card gateway |
| `…20260909100000_science_subject` (9 Sep) | Science as an assessed subject with four strands (biology, chemistry, physics, working scientifically), for the Cambridge Progression papers |
| `…20260909120000_staff_invites` (9 Sep) | `staff_invites`: invitation links for the console that do not expire and are spent only when the password is set, replacing Supabase's own invite email; the `staff_invite` email template |
| `…20260909140000_staff_permission_split` (9 Sep) | `staff.write` split into three: inviting and staffing colleagues (`staff.write`), changing the role/permission matrix (`roles.write`) and deleting an account (`staff.delete`); `can_grant_role()` and policies that stop anyone editing their own roles or handing out more than they hold |
| `…20260909160000_family_codes` (9 Sep) | `contacts.family_code`: a stable identifier per family (COE1, COE2) minted on insert and never changed, so siblings land on one account in the school's student system; `next_family_code()`, `merge_family_code()` for two parents who enquired separately |
| `…20260909180000_special_needs_photo_consent_parent_id` (9 Sep) | `applications.has_special_needs`/`special_needs_detail` asked at enquiry; the optional `photography_consent` agreement; `parent_id` added to the required documents |
| `…20260909190000_offer_uniform_and_books` (9 Sep) | The offer letter says uniform and books are not in the fees and are invoiced separately; a new template version, so offers already sent keep their wording |
| `…20260909200000_retire_old_story_chapters` (9 Sep) | The Tumi chapters move up a stage after the school found them too hard: the old grade-keyed templates stand down, the content is re-keyed by story (garden, river, village, market, hill) and a gentler Reception chapter is added; refuses to finish if a grade is left with two active chapters |
| `…20260910120000_zavu_template_id` (10 Sep) | `message_templates.zavu_template_id`: the third identifier for one approved wording, because Zavu addresses a template by its own id as Meta does by name and Twilio by SID. No shape check — unlike Twilio's `HX…`, Zavu's id has no documented form |
| `…20260910100000_twilio_content_sid` (10 Sep) | `message_templates.twilio_content_sid` (checked `HX` + 32 hex): Twilio addresses a WhatsApp template by the SID of the Content Template wrapping it, not by Meta's name, so a row carries both and each adapter reads its own |
| `…20260909250000_potch_stages_and_guardian_title` (9 Sep) | Potchefstroom's own five South African stages (Babies, Toddlers, Junior, Grade RR, Grade R) mapped to its CBD codes — it was priced but taught nothing, so no parent could apply to it; and `registration_contacts.title`, which Ed-admin requires and which is what genders its Relation list without guessing |
| `…20260909240000_ed_admin_grade_codes` (9 Sep) | `campus_grades.external_grade_code`: what each stage at each campus is called in Ed-admin (`Stage5-HPS`, `NURSERY-TLK`, `RECEP_PHASE_2`), seeded from the mapping the school gave. Its importer matches the exact string and drops anything else in silence, which is why exported students arrived with no grade and therefore no family |
| `…20260909230000_delete_application` (9 Sep) | `applications.delete`, held by the super administrator alone; `delete_application()` (service role only) removes an applicant and everything that cascades from it and leaves one audit row naming what was destroyed; admission decisions gain the one narrow escape from append-only that the cascade needs, and updates are still refused |
| `…20260909210000_tuition_per_month` (9 Sep) | `tuition_month` as a fee line, for a campus that prices by the month; the offer letter gains a "Tuition per month" row above the annual one, printed only when the schedule carries it |
| `…20260909000000_story_assessments` (9 Sep) | Story delivery: `assessment_templates.delivery`/`story_character`, scene fields on sections, narration/answer mode/scene focus/adult note on questions and on the frozen form, the `adult_marked` question type, four early-years competencies and the `personal_social` subject; `launch_attempt()` copies the story fields |
| `…180000_plain_english` (7 Sep) | Data only: plain-English (CEFR B1 to B2) versions of the offer letter and of eleven emails whose sentences were long or used phrases that do not travel |
| `…20260907090000_stage_7_active` (7 Sep) | Data only: Stage 7 switched on after the school confirmed the primary phase runs Stage 1 to 7, so it appears in the parent's stage list at the campuses that already offer it |
| `…120000_school_closures_and_weekday_sessions` (7 Sep) | `school_closures` (the 2026 term calendar seeded), the `auto_sessions_*` settings that keep a sitting and a visit on the books every weekday at every campus |
| `…100500_policy_documents_and_signatures` | `agreement_templates.sort_order`, links that may be a path on this site, `agreement_acceptances.signature_svg`; the four January 2026 documents (Learner Code of Conduct, Parent Policy, Fees Policy, Parent Acknowledgement and Agreement) in their own words |

## Rules for new migrations

1. **Filename `YYYYMMDDHHMMSS_snake_case.sql`**, and once a migration has been
   applied anywhere its filename must equal the version the database recorded.
   Never invent the timestamp after the fact. CI checks the shape and refuses
   edits to files already on `main`.
2. **Never edit an applied migration.** Add a new one. The twenty-four here are
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

## The school's intake papers

`seed/secondary_intake_2026.sql` is content, not schema: the school's own
English and Mathematics intake papers for Form 1 to Form 4, transcribed from
the Word documents supplied in September 2026. It creates the bank
"Secondary intake tests 2026", a rubric per marker-judged question (the band
descriptors carry the school's model answer, so the marker sees the key
beside the child's writing), and four active templates, one per intake year,
each an English section and a Mathematics section of 20 minutes. Seven
corrections to the papers were made on the school's instruction and are
marked "Corrected" in the file: two marking keys that contradicted the
passage, one Section B question whose wording contradicted its numbers, and
four multiple-choice items whose printed options held no single correct
answer. Loaded on the live project on 7 September 2026; from then on the bank
is maintained under Set up → Question banks. Refuses to run twice.

## Local rehearsal

```sh
su postgres -c "supabase/tests/replay_local.sh"
```

Creates `hibiscus_local` from scratch on a stock Ubuntu Postgres, applies
`tests/local_supabase_stub.sql` (roles, `auth.uid()`), every migration in
order, then `tests/security_regression.sql` (43 attacks, each with a control
that the legitimate case still works). Exit code 0 means both "the schema
builds" and "the schema refuses what it should".
