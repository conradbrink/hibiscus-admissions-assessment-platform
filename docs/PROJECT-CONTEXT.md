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
- **The AI never decides an outcome.** Outcomes come from the rules engine
  or a person. The AI writes prose over computed numbers behind a validator;
  no active ruleset means every assessed applicant is reviewed by a person.
  Since 7 September 2026, on the school's instruction, it does mark written
  answers against each question's rubric (`ai_auto_mark_enabled`, migration
  `20260907123000`): the mark is recorded as `marking_method = 'ai'` with the
  band and rationale, is visible and overridable on the attempt page, and
  applies only when `AI_PROVIDER` is a real provider. Blank answers get the
  lowest band without a model call; an answer the model cannot mark hands
  the attempt to a person as before.
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

### Plain English for parents (7 September 2026)

Everything written to a parent (letters, emails, WhatsApp, the assessment
report, the learning profile, the parent pages) is at CEFR B1 to B2: short
sentences of 10 to 20 words, one idea each, common words, active voice, no
idioms, international formats. The AI prompts carry the same rules
(`PLAIN_ENGLISH_RULES`). Migration `…180000_plain_english` republished the
offer letter and eleven emails to that standard; the rest already met it.

### WhatsApp through Twilio (10 September 2026)

- The school uses **Twilio**, so `lib/messaging` has a third adapter beside
  `dev` and `meta`. Meta was not removed: a row can carry both identifiers and
  the switch is `MESSAGING_PROVIDER`, so moving between them is configuration.
- Twilio does not send a template by name. It wraps the approved template in a
  **Content Template** with a SID (`HX…`) and takes the variables as one JSON
  object keyed `"1"`, `"2"`. There is no separate button component, so a
  message with a link carries its token as the variable after the body's — the
  template has to be authored that way, and the runbook says so.
- Twilio's webhook signature covers the **URL and every form field**, sorted by
  name and concatenated with no separator, under HMAC-SHA1. The adapter is
  handed the request URL for that reason, and `TWILIO_WEBHOOK_URL` overrides it
  where a proxy makes the app see a different address than Twilio called.
- Untested against Twilio itself until the account exists: the payload, the
  signature and the webhook parsing are unit tested against Twilio's documented
  shapes, but no real message has been sent.

### Deleting an applicant (9 September 2026)

- Three ways to end an application, and they are not interchangeable.
  **Withdraw** stops the pipeline and keeps the record, which is what staff
  want almost always. **`anonymise_application`** (the retention run) removes
  the person and keeps the status, dates, campus and grade, so the reports
  stay honest — this is the answer to a data-protection erasure request.
  **`delete_application`** removes everything, and exists for records that
  should never have existed: a form submitted twice, a training entry, a
  walk-in typed against the wrong family.
- The delete is gated three ways: `applications.delete`, held by the super
  administrator alone; the campus check every applicant action goes through;
  and the reference typed back by hand. Files leave storage before the rows
  go, because a storage failure has to be able to abort the whole thing and
  cannot do that from inside the database.
- Admission decisions are still append-only. The trigger now allows a delete
  when `app.deleting_application` is set — a transaction-local flag only
  `delete_application` sets, around its own statement — because the cascade
  needs it. An update is refused as it always was, and check 43 of the
  security suite proves both.
- One audit row survives, naming the reference, the child, the parent, the
  campus, the status and the reason. An audit trail that cannot say what was
  destroyed is not one.

### Phones, WhatsApp and bank details (7 September 2026)

- **Since 9 September a form asks for the country and the number separately**
  (`MobileInput`, rules in `lib/phone.ts`, the same check server-side through
  `mobileNumber`/`optionalMobileNumber`). The school messages on WhatsApp,
  which takes nothing but E.164, and a single field is guesswork the moment a
  third country appears. Twelve countries have a mobile rule; anything else is
  entered under "Somewhere else", where the shape is checked and the network
  is not. Staff can correct an older number from the applicant page.
- `normaliseMobile` in `lib/contacts.ts` stays for what arrives from outside a
  form — an import, a webhook matching an inbound WhatsApp number — where
  there is no country to ask for. It leans on the fact that a Botswana and a
  South African number never share a length (8 digits or 0 + 8 is Botswana;
  9 or 0 + 9 is South Africa). It is deliberately the lenient path; the forms
  are the strict one.
- WhatsApp updates are on by default at enquiry, beside a plain notice and
  a one-tap untick; STOP still opts out. The tick is still recorded as the
  parent's choice (`whatsapp_opt_in_source`), which is what Meta's opt-in
  rule asks for: a clear notice where the number is given.
- Bank details are per campus: `bank_instructions` may carry a row per
  campus, and the Fees page edits one per campus beside the currency
  default a campus without its own falls back to. The offer letter, the
  payment page and the payment emails all resolve through
  `loadBankInstructions`, campus first.
- The AI narrative may not use he, she, his or her: the data never says the
  child's gender. The validator refuses a guessed pronoun and the retry
  names it; the prose uses the first name or they (prompt version 4).

### Where an enquiry shows up, and "How did you hear about us?" (7 September 2026)

- The three doors on `/join` all create an application. A request for a
  call is `callback_requested` (counted under "New enquiries", with a
  `callback` task for staff); a visit is `visit_booked` (its own
  "Visits booked" row); an assessment is `assessment_booked`. The dashboard
  pipeline now also shows "Withdrawn". The applicants list groups all
  three doors under "Enquiries".
- `applications.source` is the door (website, staff, walk-in);
  `applications.heard_from` is the advertising answer, one key from
  `web/lib/heard-from.ts` (Google, social media, a friend, a current
  parent, an open day, radio or print, signage, other + a free line).
  Every interest form asks it; the analytics Breakdown has a "How they
  heard about us" dimension and the CSV export carries it.
- Where the child sits: the booking card on `/next/booked` and
  `/next/booking`, the booking confirmation, both reminders, the visit
  confirmation and the calendar file all print the campus's address and
  phone lines (`campuses.address`, exposed to templates as
  `campus_address`). The assessor's six-letter code exists only at launch
  on the check-in board; the attempt page can re-issue it while the sitting
  is still waiting (see the runbook).
- **Promotions** (`promotions`, `promotion_effects`, `application_promotions`,
  Settings → Promotions): a deal waives the application and/or admission
  fee, takes an amount or a percentage off the admission fee, and adds
  gifts, each with the wording the parent reads. A deal with a **code** is
  typed by the parent at enquiry (the field only appears while a coded deal
  is live; a wrong code is refused on the spot); a deal without one applies
  by its rules (campus, year, grade band, entry route, heard-from, dates,
  first N). The deal is applied **once, when the offer is drafted**
  (`resolvePromotion` → `applyPromotion` in `web/lib/promotions/`), pinned
  on the application and on `offers.promotion_id`, printed on the letter,
  the PDF, the parent's offer page and the results email. Staff can apply
  or remove a deal on the Offers page before approval (re-draft, audited,
  reason required). A fully waived offer records a `waived` payment of zero
  and goes straight to registration with the `fees_waived` email. Editing a
  deal later never changes a letter already drafted: the fee snapshot on the
  offer is what was agreed.

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

### Phase 4 (PR #4) — messaging, AI extraction and summaries, export, analytics, automation

The specification's Phase 4, built on the seams Phase 3 left. Every
automation and every AI feature is behind a setting that ships off.

| Area | State |
|---|---|
| Four more migrations (22 total): messaging, document readings and summaries, export and the facts view, automation | Done, replayed from empty |
| **WhatsApp** as a companion channel: explicit opt-in on the enquiry, the registration and the hub; a message is always a Meta-approved template mapped onto our variables; the email handler queues the companion after a send; replies become tasks, STOP opts out; Meta Cloud API adapter over `fetch`, `dev` adapter delivers nothing | Done; Meta untested against a real account (§5) |
| **AI document extraction**: birth certificates, reports and vaccination cards read through the AI seam with the file attached and a schema per kind; a reading is a proposal on the document row; a disagreement flags the parent's form and opens a task; **nothing writes the registration**; medical documents are never sent | Done; untested on real scans (§5) |
| **Applicant summaries**: facts and attention flags computed in code (always current), prose by the model only when switched on and only if the validator passes; the pipeline shows the flags | Done |
| **Student export** (the Ed-admin integration until its API is known): CSV/JSON batches with configurable columns, medical off by default, records remember their batch; `StudentManagementSystem` seam unchanged | Done |
| **Analytics**: `v_application_facts`, the Stage 27 funnel by campus, grade, period, lead source or assessment outcome, conversions, cycle times, Stage 28 parent-effort figures, a weekly trend, CSV export; **forecast** of expected enrolments against capacity with every rate and sample size shown | Done |
| **Automation**: waitlist promotion (task, or decision with the switch); data retention through one function with preview and holds; the morning digest per campus team; the rebooking gaps (cancellation email, one nudge that stops on rebooking, an online cutoff) | Done |
| Security regression suite: 41 attacks with controls | Done |

**The agreements are the school's four January 2026 documents, in their
own words, and the parent signs them.** The Parent Acknowledgement and
Agreement is what a parent signs; by signing it they acknowledge the
Learner Code of Conduct, the Parent Policy and the Fees Policy. All four
are required agreements, shown in that reading order with the full text of
each document as its body (so the hash on the acceptance is the hash of the
document), and each links to the PDF, which the application serves itself
from `web/public/policies/2026/` so the text and the file are always the
same edition. The parent signs once, in a box, with a finger or the mouse;
the server validates the strokes, refuses a tap, renders the SVG itself and
stores it on every acceptance beside the printed name. Staff see the
signature on the registration page. Retention deletes the acceptances, so
the signature goes with the rest of the person. The Phase 3 placeholders
and the earlier title-only acknowledgements are retired.

Not built: malware scanning (seam in `lib/documents/scanner.ts`), an HTTP
adapter for Ed-admin (the file export is the integration until the API is
known), staff editing of submitted registration data, AI email drafting.

### Story assessments (PR #48) — Reception to Stage 3

A read-aloud, adult-marked assessment in the style of Cambridge's early
years "Check Together": one story (Tumi's Journey), one chapter per stage,
scenes with drawn pictures, a talking character, and an adult beside the
child recording **Yes / Partly / Not yet**. Built inside the existing
engine: a story template is a template with `delivery = 'story'`, a scene
is a section, and every story field is snapshotted into `form_questions`
at launch. One new question type, `adult_marked`, whose key is the
expected answer in words and whose marks are full, half or none. The
kiosk player (`components/kiosk/story`) draws Tumi, the backdrops and every
prop in SVG and speaks through the browser's speech synthesis (softest
female English voice; a seam for recorded clips). Content lives in
`web/content/story/*.json` and is seeded idempotently by
`web/scripts/story-seed.mjs`. Nothing about marking, scoring, decisions or
the learning profile changed shape.

### Cambridge papers (PR #52) — entry to Stage 4 and above

The school's licensed Cambridge Primary Progression Tests 2025 (English,
Mathematics and Science for Stages 4, 5 and 6), digitised into the
existing on-screen paper runner. Content lives as JSON in
`web/content/papers` with the figures as PNGs beside it, and
`web/scripts/paper-seed.mjs` seeds banks, passages, questions, keys from
the mark schemes, two writing rubrics per stage and one template per
entry stage. A sitting is 40 minutes in three timed parts (English 15,
Mathematics 13, Science 12), each part a selection from its paper that
fits the time; the full papers stay in the bank for staff to draw on.
Stage 6 covers entry to both Stage 6 and Stage 7. Question pictures are
served by `/api/sit/media`, which answers only an open sitting or a
signed-in staff member, so the licensed material never sits on a public
address.

### The family CRM, stage A (PR #60) — a child after the funnel

The pipeline ends at `enrolled` and always will: `states.ts` lists no move
out of it, and `commit_transition()` is still the only writer of
`applications.status`. What changes is that enrolment now also produces
rows that outlive the application.

- **`families`** promotes `contacts.family_code` from an indexed, deliberately
  non-unique string to a row. The code itself is untouched and still
  immutable — it is what the school's other system bills — and
  `merge_family_code()` keeps its signature while now moving contacts and
  students onto the surviving family. The unique index is partial
  (`where merged_into_id is null`) so a merged family keeps the code it was
  exported under.
- **`students`** is the child, for as long as the school has them: the same
  fields `registrations` collects, but living rather than frozen, plus
  `origin_application_id` as provenance. Its read policy asks the student's
  own `current_campus_id` rather than reaching through an application,
  because a child outlives the one that admitted them; a trigger keeps that
  column in step with their newest live enrolment.
- **`enrolments`**, one per student per academic year, with the full status
  set listed now so a later stage adds code rather than a constraint.
- `onEnrolmentConfirmed` calls `promoteToStudent` before the transition, so a
  failure refuses the enrolment rather than half-enrolling a family, and the
  migration backfills every child already enrolled from their frozen
  snapshot.
- **Retention is guarded**: a trigger refuses to stamp `anonymised_at` on an
  application a student was enrolled from. An enrolled child is not an
  abandoned enquiry, and erasing their registration would gut the record the
  register now shows. Security checks 45 to 47 cover the campus scoping, the
  absent insert policy on `students`, and that guard.
- `/staff/students` and `/staff/students/[id]` are the register, read-only for
  now, behind the new `students.read` and `students.write`.

### Three more things the school owns

- **Bank details** for transfers: `/staff/admin/fees`, per currency. Until
  set, the payment page offers online payment only.
- **Agreements**: the four 2026 documents are seeded from the PDFs the
  school supplied. When a document is revised, publish the new wording at
  `/staff/admin/agreements` and replace the PDF (see the runbook).
- **Document requirements**: seeded from the specification (birth
  certificate, vaccination card, school report and transfer certificate from
  Stage 1, optional medical documentation); edit at
  `/staff/admin/document-requirements`.

### Three things the code deliberately does not invent

- **Admission thresholds.** No ruleset is seeded or active. Every assessed
  applicant goes to the review queue until the school activates one at
  `/staff/admin/rules`. The dev seed's ruleset is a draft.
- **The question bank.** `supabase/seed/dev_phase2.sql` holds a sample bank
  flagged `is_sample`, for development databases only. The school's real
  secondary papers (Form 1 to Form 4, English and Mathematics) are in
  `supabase/seed/secondary_intake_2026.sql`, loaded on the live project on
  7 September 2026 as the bank "Secondary intake tests 2026" with four active
  templates. Comprehension and writing answers are marker-judged against
  rubrics whose descriptors quote the school's model answers; the Part C
  writing bands are a draft for the school to confirm. Seven printed errors
  were corrected on the school's instruction (listed in the seed's header).
  Primary (Stage 1 to 7) papers have not been supplied yet.
- **Sessions.** The school asked (7 September) for a sitting and a visit to
  be bookable every weekday at every campus except on school holidays. The
  drain keeps them created six weeks ahead from the `auto_sessions_*`
  settings (`lib/workflow/automation/sessions.ts`), skipping the dates in
  `school_closures`, which is seeded with the 2026 term calendar and edited
  at `/staff/admin/closures`. A day that already has a session of that kind
  at that campus is left alone, so hand-made sessions replace rather than
  duplicate the automatic one.
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
- **WhatsApp is companion-only and template-only.** No engine action knows
  the channel exists: `handlers/send-email.ts` queues a `send_whatsapp` job
  after an email goes, keyed on the email's idempotency key. Meta allows free
  text only inside a 24-hour reply window, so the contract is "this approved
  template, these parameter values"; a reply from a parent becomes a task and
  is answered by phone or email. Templates are approved in Meta Business
  Manager by hand; the runbook has the loop.
- **Meta rejects parameters with line breaks**, so `sanitiseParam` folds the
  bank details onto one line and caps length; and the URL button's suffix is
  the raw magic-link token, minted at send time like the email's.
- **Extraction proposes; the parent's save is the write.** The reading lives
  on the document row, the disagreement on `registrations.mismatch_flags`,
  and `saveStudent` clears the flags. A grep in the security suite's spirit:
  nothing under `lib/documents` or `handlers/documents.ts` updates
  `registrations` fields. The student step also *offers* the reading: with
  the extractor on, it invites the birth certificate first and
  `applyCertificateReading` fills the form's empty fields (middle names,
  place of birth, gender, registration number) marked "please check"; the
  enquiry's names and date of birth are never overwritten.
- **Every document has a PDF.** `lib/documents/staff-pdf.ts` renders the
  offer, receipt, profile, registration record and signed agreements for
  staff from stored records (the parent routes render the same documents
  from their own session); `/staff/applications/[id]/pdf/[kind]` reads the
  application under RLS first and audits the download. The signature on
  the agreements PDF is redrawn from the stored path with react-pdf's Svg,
  never from markup.
- **Uploads go straight to the bucket.** `/api/register/document/start`
  hands the browser a signed upload URL under `applications/<id>/`,
  `/complete` reads the object back and judges it exactly like a server
  upload (`adoptUploadedObject`), so Vercel's request-size limit never
  meets a photo. Big images are shrunk on the phone (`lib/documents/shrink.ts`).
  The multipart route stays as the no-JavaScript fallback.
- **The summary's flags are code, its prose is optional.** `summaryFacts` is
  pure and runs on every page load; the stored prose is shown only while its
  input hash matches, so a stale paragraph is never presented as current.
  The staff summary uses the profile's banned terms minus the process words
  a staff reader needs (offer, accept, admit…).
- **`server-only` modules cannot be imported by vitest.** Pure rules live in
  files without that import (`lib/workflow/automation/rules.ts`,
  `lib/documents/compare.ts`) and the server modules import them.
- **Retention deletes through one function.** `anonymise_application()` is
  `security definer`, revoked from every role but the service role, and the
  application row survives with its status, dates, campus and grade so the
  analytics still count it. Storage objects are removed by code *before* the
  function runs. `child_date_of_birth` is `not null`, so it becomes
  1900-01-01 rather than null.
- **Daily jobs gate themselves** on `maintenance_runs`, because the cron is
  every five minutes; the digest is keyed `digest:<campus>:<date>` in
  Gaborone time, and `jobs.application_id` is nullable so a job can belong to
  a campus rather than an applicant.
- **The rebooking flow already existed** (`/next/book` in "changing" mode,
  `onRescheduled`); Phase 4 added what was missing around it: the
  cancellation email, one `rebook_nudge` with a `booking_none` precondition,
  the online cutoff, and the missed session named on the page.

### One list, or it will drift (10 September 2026)

The fee vocabulary lived in five places: the check constraint on `fee_lines.code`,
a `FEE_CODES` constant in the fees admin, the `FeeCode` union in `types.ts`, the
variable map in `buildOfferVariables`, and the sample values in the offer
template editor. Two migrations widened the constraint; neither touched the
other four. The drift was not cosmetic:

- The admin's save loop iterated the *constant*, not the lines the schedule
  actually had, so saving a schedule with one fee wrote five, four of them zero.
  Every line prints on the parent's offer page and in the PDF, so a pre-school
  offer was one press of Save away from quoting "Tuition per term P 0.00".
- `stationery_annual` reached the database and nothing else, so Bana Tlokweng's
  stationery fees rendered as an editable field whose edits were discarded.

`web/lib/fees/codes.ts` is the list now, and the parsing that reads a submitted
schedule lives beside it — in `lib/`, because that is where anything with a test
has to live. Adding a fee code means the constraint, that file, and a new offer
template version that both references the variable and adds it to
`allowed_variables` (`20260909210000_tuition_per_month.sql` is the recipe;
`20260910160000_bana_tlokweng.sql` is what skipping the template step looks
like — Tlokweng's stationery line reaches the PDF and the parent's offer page,
which loop over every line, but not the letter body, which names variables one
by one).

### An empty fee schedule is not a fee schedule (10 September 2026)

`resolveFeeSchedule` returns `lines: []` rather than null for a schedule with no
fee lines, and `snapshotFees([])` returns a perfectly valid snapshot of nothing,
which is truthy. So an active schedule with no lines used to sail past the
`if (!fees)` guard in `onOfferDrafted` — no `offer.blocked` event, no
`configure_fees` task — and send a parent a letter reading "Payable to accept
the offer — P 0.00", which then throws at acceptance. `onOfferDrafted` now treats
an empty schedule as no schedule, which is what the migration author assumed
when they gave Bana Tlokweng's Nursery "a schedule with no lines rather than an
invented one". The admin refuses to make an empty schedule active as well.

### Zero is a real amount (10 September 2026)

Accepting an offer created a payment request, and creating a payment request
refused a zero amount unless a promotion had waived it. That refusal was raised
*after* the acceptance row and the offer's `accepted` status had been written,
and the closing `commit()` never ran — so the parent saw an error, the
application sat in a state no screen could advance, and pressing Accept again
hit the unique index and said the offer had already been answered.

Bana Tlokweng charges nothing to secure a place: their sheet says "Registration
Fees: None", and all ten of their active schedules are built that way. Every
one of their families would have hit it. Nobody had reached the offer stage
there yet, so nothing needed repairing.

There are three honest answers to "what is due now", and the code had collapsed
two of them into an error. `lib/payments/due.ts` names them: **payable**,
**waived** (a deal removed a fee that was owed), **none** (nothing was ever
owed) — and only an offer carrying no fee snapshot at all is a mistake.

`waived` and `none` are kept apart all the way to the parent's inbox, through a
new `payments.method` value and a `fees_none` email template. "We waived your
fee" is a kindness to someone who expected to pay and a small lie to a family
who never owed anything, and finance should be able to tell the two apart in
the record.

### Learned on the live walkthrough (7 September 2026)

- **Name the foreign key when embedding `contacts` from `applications`.**
  PostgREST sees two paths (the direct `contact_id` and the many-to-many
  through `application_guardians`) and refuses the bare `contacts(...)`
  with PGRST201. The local replay never runs PostgREST, so this only
  showed on the deployed site: the pipeline, the applicant page,
  assessment day, the registration page and the fresh-link action all
  threw. Every embed is now `contacts!applications_contact_id_fkey(...)`.
  Any table with two routes to another needs the same hint.
- **Vercel's Hobby plan allows only daily crons.** The five-minute drain
  runs from `.github/workflows/drain.yml` (repository secrets `DRAIN_URL`
  and `CRON_SECRET`); `web/vercel.json` keeps a daily call as a fallback.
- **Vercel needs Root Directory `web` and Framework Preset Next.js.** With
  the defaults it builds the repository root as a static site and serves
  `NOT_FOUND` on every path.

- **Story mode never sees a key.** The kiosk cannot know whether a tapped
  answer was right, so the stop-after-misses rule counts only the adult's
  "Not yet". Child-answered items in Stage 2 and 3 flow to the marker like
  any paper item.
- **Speech starts on a tap.** Browsers refuse to speak before a user
  gesture, which is why the story opens on a "Start the story" button and
  not on page load. Voices load asynchronously (`voiceschanged`); the
  chooser lists only English voices.

- **A part can have its own clock.** `template_sections.time_limit_minutes`
  was in the schema from Phase 2 but nothing used it; the Cambridge papers
  do. The clock starts when the child presses Start on that part and is
  kept in the browser, so reopening the page restarts the part's clock
  while the sitting's own clock keeps running. The server's clock still
  decides the sitting.
- **The Cambridge papers are licensed, not public.** Question pictures go
  through `/api/sit/media` behind the kiosk cookie or a staff session, and
  the PDFs themselves are not in the repository.

## 4. Reference data to confirm with the school

Seeded from the current website on 4 September 2026. Where the site
contradicts itself, the choice made is recorded and must be confirmed.

| Item | What the site says | What is seeded | Confirm |
|---|---|---|---|
| Form 3 / Form 4 age | Both "turning 14 before end July" | Form 3 = 14, Form 4 = 15 | **Confirmed** |
| Stage 7 | In the dropdown as "Stage7-HPS", not in the age table | **Confirmed by the school on 7 September: Stage 1 to 7.** Active from migration `20260907090000`, age 12 | Which campuses offer it (seeded for Broadhurst and Block 7) |
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
11. **WhatsApp Business account.** Set `MESSAGING_PROVIDER=meta` with the
   Cloud API credentials, register `/api/webhooks/whatsapp` in Meta with the
   verify token, submit each template in Meta Business Manager, enter its
   name under Set up → WhatsApp templates and activate it, then switch
   `whatsapp_enabled` on. The adapter follows Meta's documented Cloud API
   and is pinned by unit tests; it has not been run against a real account.
12. **Malware scanning on uploads.** Every document is stored as
    `not_scanned` and staff see that label; `lib/documents/scanner.ts` is
    the seam. Choose a scanner (ClamAV, a scanning API) and implement it.
15. **Document extraction on real scans.** Set `DOCUMENT_EXTRACTOR=anthropic`
    with `AI_PROVIDER=anthropic`, switch `ai_extraction_enabled` on, and read
    a handful of real birth certificates and reports before trusting the
    comparisons; the schemas and prompts are tested, the model's readings of
    Botswana's documents are not.
16. **Retention periods and what survives** (§2, Phase 4): the defaults are
    180 days for abandoned enquiries and a year for closed applications, and
    the anonymised row keeps status, dates, campus and grade for the
    analytics. Confirm both against the school's DPA/POPIA policy before
    switching `retention_enabled` on.
17. **Ed-admin's import format.** The export columns are a best guess at a
    student import; get Ed-admin's actual template and set the columns under
    Set up → Export columns. An HTTP adapter is a second implementation of
    `StudentManagementSystem` once the API is known.
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
- The **signature pad** has been exercised with a mouse in a desktop
  browser; the pointer-event handling for fingers and styluses on phones
  and tablets follows the standard API but has not been tried on a device.
  The server side (strokes validated, ink measured, SVG rendered from
  numbers only) is unit tested.
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
- **Meta's WhatsApp Cloud API** has not been called: the request body,
  signature check and webhook parser are pinned by unit tests; the first
  approved template will be the first real send.
- **Claude reading a real document** has not been tried; the dev AI adapter
  returns a labelled sample reading and the comparison logic is tested on
  fixtures.
- **Supabase Storage object removal** (retention) follows the documented
  client API; exercised only against the local database, which has no
  Storage.
- The **Phase 4 walkthrough** in PR #4's description has been exercised
  against the SQL functions, the unit tests and the local replay, not by a
  person in two browsers.

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
