# Project context

Handoff document. Read this first in a new session.

## 1. What this is

An admissions and assessment platform for Hibiscus Schools, Botswana (eight
campuses: five pre-schools, a primary school, a primary-and-secondary school,
and one in Potchefstroom, South Africa — confirmed, see §4). It
replaces the Ed-admin online application form at
`hibiscus.ed-space.net/onlineapplication.cfm`.

The full architecture proposal that was approved before any code was written
is in the pull request that introduced this repository. The short version:

- **Parent experience**: enquire (8 fields) → confirm grade → book a slot →
  attend → results → offer → accept → pay → register → enrol. No account. One
  next action at a time, reached from an emailed link.
- **Staff experience**: a pipeline, an applicant profile with a full timeline,
  an assessment-day check-in board, tasks, and admin for everything the
  process reads its configuration from.
- **Automation**: an event-driven workflow engine queues emails and follow-ups
  with preconditions, so a reminder for a cancelled booking is never sent.

### Locked-in decisions (do not re-litigate)

- **Stack** mirrors the team's other product (Gold Fortune): Next.js 16 App
  Router, TypeScript, Tailwind 4, shadcn `base-nova` on `@base-ui/react`,
  Supabase Postgres with RLS, Vercel. Same CI shape.
- **Parents never get accounts.** Magic links exchange for a signed cookie
  scoped to one application. There is no parent RLS; parent routes use the
  service role and scope every query themselves.
- **The state machine is code** (`web/lib/workflow/states.ts`); what it
  *consults* (reminder offsets, expiry windows, templates, fees) is data.
- **One writer of `applications.status`**: `commit_transition()` in Postgres,
  called only by the engine. Staff clients have no UPDATE grant on the column.
- **No email wording in code.** Templates are database rows with an
  allow-list of variables, validated at save time.
- **Tests from day one, lint blocking from the first commit** — deliberate
  departures from the sibling repo, explained in the CI file.
- **Permission-native from migration 1** (no role-string layer to migrate off).
- **Answers never leave the server.** Keys are readable by content authors
  and the marker (service role). The kiosk reads the frozen form; a unit test
  greps the delivery code for the key tables.
- **The AI never decides.** Outcomes come from the rules engine or a person.
  The AI writes prose over computed numbers behind a validator; no active
  ruleset means every assessed applicant is reviewed by a person.
- **A human clicks before anything reaches a parent after a decision.**
  Offer approval and outcome emails are buttons in Phase 2. The switches
  `offer_auto_approve` and `auto_send_outcomes` exist, default off, and are
  the school's to flip once it trusts the wording.
- **Snapshots, not references.** A sitting is a frozen form; an offer is the
  HTML and fees rendered at approval; a decision records its inputs. Editing
  a question, template or fee schedule never rewrites history.
- **Potch is South Africa: ZA / ZAR.** Currency hangs off the campus and is
  copied onto fee schedules and offers by trigger. POPIA applies alongside
  the Botswana DPA. The campus stays inactive until its grades are assigned.
- **Written language is marked by a person** against a rubric; the AI may
  suggest a band, stored as advice, never as marks.
- **Declined applicants receive the learning profile** (setting
  `profile_shared_on_decline`, default on).

## 2. What is built

### Phase 1 (PR #1)

| Area | State |
|---|---|
| Schema, 9 migrations, full RLS, replayable from empty | Done — `supabase/tests/replay_local.sh` proves it |
| Workflow engine, job outbox with preconditions, drain via `after()` + cron | Done |
| Magic links, parent session cookie, rate limiting | Done, unit tested |
| Email: templates, renderer, dev outbox, Resend adapter, delivery webhooks | Done (Resend adapter unexercised against the live API — see §5) |
| Parent funnel: `/join`, three routes, grade recommendation, slot picker, `/next`, `/link` | Done |
| Staff: login, dashboard, pipeline, applicant profile + actions, check-in board, tasks | Done |
| Admin: sessions, templates (with preview), staff & roles, campuses, grades + matrix, intakes, settings, outbox, jobs | Done |
| Analytics v1: funnel, conversion, cycle times, parent-effort | Done |
| Security regression suite (14 attacks with controls) | Done, passes on local replay |

### Phase 2 (PR #2) — assessment, decision, learning profile, offer

The journey now runs from a checked-in booking to `offer_sent`. Phase 2 ends
there: electronic acceptance and payment are Phase 3, and the parent's
`/offer` page says so.

| Area | State |
|---|---|
| Five more migrations (14 total): competencies, question bank and answer keys, frozen forms and attempts, rulesets and append-only decisions, fee schedules, offer templates and offers | Done, replayed from empty |
| Authoring admin: banks, questions of seven types with per-type keys, passages, rubrics, templates with fixed or random sections, benchmarks, competencies | Done |
| Launch from the check-in board: template resolved by grade and campus, accommodation multiplier, single-use code and QR | Done |
| Kiosk (`/sit`): one question per screen, practice item, server-authoritative timer, autosave, resume on the same computer, auto-submit at time-out | Done |
| Automatic marking of six types; rubric marking of writing by an assessor with an AI-suggested band; scores by competency, subject and overall against benchmarks | Done |
| Rules engine: versioned rulesets, hard-fail and review rules, capacity → waitlist, no ruleset → a person; review queue; decisions append-only | Done |
| Learning profile: computed numbers, AI narrative (Anthropic) behind a validator, deterministic fallback; parent page and PDF | Done; AI adapter untested against the live API (§5) |
| Offers: fee schedules per campus/year/grade band, versioned offer template with preview, drafting on approval, blocked-on-fees state, human approval, parent page and PDF, reminders and expiry, withdraw and re-issue | Done |
| Console: applicant tabs (assessment, profile, decision, offer), Offers & outcomes queue, dashboard queues, analytics for decisions and offers | Done |
| Security regression suite extended to 22 attacks; dev seed with a labelled sample bank | Done |

### Phase 3 (PR #3) — acceptance, payment, registration, documents, enrolment

The journey now runs to `enrolled`. The parent accepts electronically, pays
online or by bank transfer, completes a six-step registration prefilled
from what they already told us, uploads documents and signs agreements by
typing their name; a person confirms enrolment and the welcome email goes.

| Area | State |
|---|---|
| Four more migrations (18 total): campus scoping fails closed; acceptances, payment requests, payments, bank instructions; registrations, contacts, document requirements, documents, agreements; student records; `dashboard_counts()` with the Phase 3 queues | Done, replayed from empty |
| Every school's team sees its own school: `roles.campus_scoped`, `can_access_campus()` fail-closed, `v_accessible_campuses` behind every filter, scoped `audit_log`, staff actions read through RLS before any write | Done; checks 4b, 23, 24, 26, 31 |
| Offer acceptance with an immutable record (snapshot hash, terms, ip/device, version); decline with reason | Done |
| Payments: DPO Pay v6 behind a provider seam, `dev` adapter that cannot say "paid", pull-based verification on return plus a cron sweep, amount and currency must match, bank transfers recorded by finance, refunds, receipts as PDF | Done; DPO untested against the sandbox (§5) |
| Registration: student, medical, family, emergency contacts, documents (private bucket, sniffed, capped), agreements; prefill and "still correct?"; review and submit; the completeness rule shared by parent, staff and engine | Done |
| Enrolment: refused until required documents are accepted; student record snapshot; student-system seam with a `none` implementation; welcome email; `auto_enrol` switch | Done |
| Console: Payments and Registrations queues, document review through one-minute signed URLs, Confirm enrolment, JSON download, Payment and Registration tabs, admin for bank details, agreements and document requirements | Done |
| Security regression suite: 31 attacks with controls | Done |

Not built (later phases): AI/OCR document extraction (seam in `documents.extracted_fields`
and `lib/documents/extractor.ts`), malware scanning (seam in `lib/documents/scanner.ts`),
the Ed-admin adapter (seam in `lib/enrolment/integration.ts`), WhatsApp, staff editing of
submitted registration data, document retention.

### Three more things the school owns

- **Bank details** for transfers: `/staff/admin/fees`, per currency. Until
  set, the payment page offers online payment only.
- **Agreements**: two placeholder texts are seeded and say so; replace them
  at `/staff/admin/agreements` before going live.
- **Document requirements**: seeded from the specification (birth
  certificate, vaccination card, school report and transfer certificate from
  Stage 1, optional medical documentation); edit at
  `/staff/admin/document-requirements`.

### Three things the code deliberately does not invent

- **Admission thresholds.** No ruleset is seeded or active. Every assessed
  applicant goes to the review queue until the school activates one at
  `/staff/admin/rules`. The dev seed's ruleset is a draft.
- **The question bank.** `supabase/seed/dev_phase2.sql` holds a sample bank
  flagged `is_sample`, for development databases only.
- **Fee amounts.** With no active fee schedule an approved applicant rests
  at `offer_draft` with a task for finance, and approval is blocked.

## 3. Gotchas learned building this

- **Next 16 renamed middleware to `proxy.ts`**, and `params`/`searchParams`
  are Promises. Read `node_modules/next/dist/docs/` before assuming an API.
- **The React purity lint rule rejects `Date.now()` in a server component
  body.** Helpers in `lib/format-date.ts` (`hasStarted`, `daysAgoDateString`)
  exist so pages stay pure.
- **`applications` has two foreign keys to `grades`** (`grade_id` and
  `recommended_grade_id`). Every embedded select must hint:
  `grades!applications_grade_id_fkey(name)`. PostgREST rejects the
  unhinted form at runtime, not just in types.
- **`lib/supabase/types.ts` is hand-maintained** in the generated shape,
  including `Relationships`. A column added to a migration is added there in
  the same commit or the typecheck is lying. Swap for `supabase gen types`
  once a project exists.
- **`commit_transition` with a null new status is a pure event** and leaves
  `next_action` alone; pass the *current* status to change `next_action`
  without a transition.
- **An enquiry is routed on the second screen**, not the first. A parent
  who abandons between them leaves an application with `next_action = null`;
  the drain's sweep routes it after ten minutes.
- **Campus scoping is orthogonal to role, and fails closed.** Every applicant
  table's policy calls `can_access_campus()`. A person with `staff_campuses`
  rows sees those campuses; a person with none sees everything **unless**
  they hold a campus-scoped role (`roles.campus_scoped`, true for
  `campus_admin`), in which case they see nothing until a campus is assigned.
  So a school's team is: `campus_admin` + their campus for staff, and
  `admissions_manager` + their campus for the person who approves offers and
  overrides decisions there. Staff actions read the application through the
  caller's own client first (`loadApplicationForStaff`), so a posted id from
  another campus is "not found", never a write.
- **DPO Pay has no signed webhook.** Verification is pull-based: the return
  route and the cron sweep call `verifyToken`; the return URL's query string
  is never trusted. A parent who pays and closes the browser is confirmed
  within `payment_verify_minutes` by the sweep — so the cron matters.
- **`PAYMENT_PROVIDER=dev` throws on `VERCEL_ENV=production`**, not on
  `NODE_ENV`, because `next build` and previews run with the latter.
- **The documents bucket is created by code, not by migration.** The local
  replay stub has no `storage` schema; referencing `storage.*` in a migration
  breaks it. No Storage policies exist and none are needed.
- **A `"use server"` file may export only async functions** — bit again in
  Phase 3; `devGatewayEnabled` lives in `lib/payments/dev-gateway.ts`.
- **`/pay/dev` must be `force-dynamic`**: as a static page it would be
  prerendered at build with the build's env, not the runtime's.
- **Reminder jobs carry a `booking_id` precondition.** Rescheduling marks the
  old booking `rescheduled`, so its reminders skip themselves. Offer
  reminders and the expiry sweep do the same with `offer_id`, and their
  idempotency keys carry the offer id, so a withdrawn and re-issued offer
  gets its own set.
- **Raw tokens never enter `jobs.payload`.** An email job names the link
  purposes it needs (`results`, `offer`); `sendTemplatedEmail` mints them at
  send time.
- **`onOfferDrafted` is two commits** (`approved → offer_draft`, then
  `offer_draft → offer_pending_approval`) so "no fee schedule" is a real
  resting state with a task, not an exception.
- **`decision.made` is emitted only for a real outcome.** A referral to
  staff review emits `decision.referred`, so the analytics' decision
  milestone is not polluted.
- **Money formatting is hand-rolled** (`lib/money.ts`). `toLocaleString`
  with `en-ZA` produced "2 500,00" on the server's ICU and would have
  reached an offer letter.
- **A `"use server"` file may export only async functions.** `KIOSK_ACTOR`
  lives in `lib/workflow/engine.ts` for that reason.
- **Tailwind only emits classes it can see.** No template-literal class
  names; map bands to full class strings.
- **`@react-pdf/renderer` types**: `renderToBuffer` wants
  `ReactElement<DocumentProps>`; the route handlers cast through `unknown`.
  Both PDFs render from the stored snapshot, on demand, with no Storage.

## 4. Reference data to confirm with the school

Seeded from the current website on 4 September 2026. Where the site
contradicts itself, the choice made is recorded and must be confirmed.

| Item | What the site says | What is seeded | Confirm |
|---|---|---|---|
| Form 3 / Form 4 age | Both "turning 14 before end July" | Form 3 = 14, Form 4 = 15 | **Confirmed** |
| Stage 7 | In the dropdown as "Stage7-HPS", not in the age table | Seeded **inactive**, age 12 | Whether it exists and where |
| Form 5 | In the dropdown, not in the age table | Age 16, active | Whether it exists and where |
| Nursery, Pre-Kindergarten | In the age table, not in the dropdown | Active, pre-school campuses only | That they are offered |
| Which grades each campus offers | Dropdown unfiltered by campus | Pre-schools: Nursery–Pre-Reception; Broadhurst: Reception–Stage 6; Block 7: Reception–Form 5 | The whole matrix at `/staff/admin/grades` |
| Potch — CBD Maury Avenue | Listed as a campus | **ZA / ZAR (confirmed)**, still **inactive** | Which grades it offers; a ZAR fee schedule |
| Term dates 2026–2027 | Not on the site | Approximate | Real dates at `/staff/admin/intakes` |
| Age cut-off | "before end July" | 31 July of the academic year | — |
| Assessment exemption | "Reception through to Secondary … assessment" | Nursery–Pre-Reception exempt | — |
| Benchmark bands | Not on the site | Placeholder <40 / 40–59 / 60–79 / ≥80, labelled so | Real bands at `/staff/admin/benchmarks` |
| Competencies | Not on the site | English (5), Mathematics (5), Reasoning (2) | Names, and which are reported to parents |

## 5. Open items, roughly by priority

1. **Potch is confirmed ZA.** Still to do: assign its grades in the matrix,
   create a ZAR fee schedule, and choose a payment provider that settles in
   both currencies (Phase 3).
2. **DPO Pay merchant account** (BWP; a ZAR account for Potch). Sandbox
   credentials first: set `PAYMENT_PROVIDER=dpo`, `DPO_COMPANY_TOKEN`,
   `DPO_SERVICE_TYPE`, `DPO_API_URL` to the sandbox, and walk one payment
   end to end. The adapter is built from DPO's documented v6 XML shapes,
   pinned by unit tests, and has not been run against DPO itself.
3. **Email provider and sending domain** with SPF, DKIM, DMARC. Set
   `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `RESEND_WEBHOOK_SECRET`, and point Resend's webhook at
   `/api/webhooks/email`. The adapter has not been run against the live API.
4. **Brand assets.** The palette in `web/app/globals.css` is a placeholder in
   the right family; swap the brand tokens once real colours arrive.
5. **First super admin.** See `supabase/README.md`. Until one exists nobody
   can sign in to `/staff`.
6. **Publish sessions.** Parents cannot book until a session is published at
   `/staff/admin/sessions`.
7. **Potch in ZAR.** Once the campus is active it needs a ZAR fee schedule,
   ZAR bank details, and a ZAR-settling DPO service before an offer there
   can be paid.
8. **Admission thresholds, the question bank, fee amounts.** Owned by the
   school; the screens exist (`/staff/admin/rules`, `/staff/admin/question-banks`,
   `/staff/admin/fees`). Until each is set the system takes the safe path
   (§2). The written-language rubric is also the school's to write.
9. **Data protection**: Botswana DPA 2018 and POPIA (Potch) — consent
   wording, retention for declined/abandoned applicants, cross-border
   disclosure (Vercel, Supabase, Anthropic). The AI receives first name,
   grade, competency labels, percentages and bands only; never surname, date
   of birth, contacts or medical information. Confirm that is acceptable and
   whether a data-processing agreement with Anthropic is wanted.
10. **AI configuration.** `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`,
   optional `AI_MODEL` (default `claude-opus-5`). With `dev` (the default)
   every profile uses the deterministic wording, which is complete and safe;
   the school can go live without the AI and switch it on later. The
   `ai_narrative_enabled` setting turns it off without a deploy.
11. **WhatsApp** is the dominant channel in Botswana and is Phase 4 by the
   spec; worth deciding deliberately whether reminders move earlier.
12. **Malware scanning on uploads.** Every document is stored as
    `not_scanned` and staff see that label; `lib/documents/scanner.ts` is
    the seam. Choose a scanner (ClamAV, a scanning API) and implement it.
13. **Generated Supabase types** to replace the hand-maintained file (now
    1,500 lines).
14. **Playwright smoke test** of the funnel on a phone viewport, timed, and
    of the kiosk on a lab computer's browser.

### What is untested, honestly

- The **Anthropic adapter** has not been run against the live API. It is
  built on `client.messages.parse` with a Zod output format per the SDK's
  documentation; the validator and fallback are unit tested, so a wrong
  call fails safe (deterministic wording, reason recorded). The writing-band
  suggester has only been exercised with the `dev` adapter.
- The **Resend adapter**, as before.
- The **end-to-end walkthrough** (launch → sit → mark → decide → approve →
  parent pages → PDFs) has been exercised against the SQL functions and by
  reading the code, not by a person in two browsers. The plan's manual
  checklist is in PR #2's description; run it on a development database
  after `supabase/seed/dev_phase2.sql`.
- **QR scanning** on a real lab tablet.
- **DPO Pay** has not been called: the adapter follows the documented v6
  shapes and its XML is pinned by tests, but the first sandbox transaction
  will be the first real one. The reconciler, the return route and the
  finance actions were exercised with the `dev` adapter only.
- **Supabase Storage** was not exercised: `ensureBucket` and `storeDocument`
  are written against the documented client API; the first upload on a real
  project is the test.
- The **Phase 3 walkthrough** in PR #3's description (accept → pay → register
  → enrol, and the campus-scoping check) has been exercised against the SQL
  functions and by reading the code, not by a person in two browsers.

## 6. Working style that worked

- Replay the migrations from empty after every schema change
  (`supabase/tests/replay_local.sh`). It caught two bugs before any code ran.
- Write the SQL functions, then smoke-test them with `psql` before writing
  the TypeScript that calls them.
- Typecheck after every batch of files, not at the end.
- Say what is untested. See §5.
- Keep the security suite's fixtures the engine's own shapes: an attempt
  inserted the way `launch_attempt()` inserts one, a decision the way the
  engine records one. The suite's first Phase 2 run failed on a fixture
  that tried to add rules to an already-active ruleset — the freeze trigger
  was right, the fixture was wrong.
