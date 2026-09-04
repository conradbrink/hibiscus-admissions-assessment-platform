# Project context

Handoff document. Read this first in a new session.

## 1. What this is

An admissions and assessment platform for Hibiscus Schools, Botswana (eight
campuses: five pre-schools, a primary school, a primary-and-secondary school,
and one in Potchefstroom that is probably in South Africa — see §4). It
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
- **Answers never leave the server** (Phase 2 rule, already stated so nobody
  designs against it).

## 2. What is built (Phase 1)

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

Not built (later phases): computer-based assessment, question bank, marking,
learning profiles, rules engine, offers, payments, registration, documents,
Ed-admin integration. The schema's status list and the state machine already
include those states so adding them is additive.

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
- **Reminder jobs carry a `booking_id` precondition.** Rescheduling marks the
  old booking `rescheduled`, so its reminders skip themselves.

## 4. Reference data to confirm with the school

Seeded from the current website on 4 September 2026. Where the site
contradicts itself, the choice made is recorded and must be confirmed.

| Item | What the site says | What is seeded | Confirm |
|---|---|---|---|
| Form 3 / Form 4 age | Both "turning 14 before end July" | Form 3 = 14, Form 4 = 15 | The Form 4 age |
| Stage 7 | In the dropdown as "Stage7-HPS", not in the age table | Seeded **inactive**, age 12 | Whether it exists and where |
| Form 5 | In the dropdown, not in the age table | Age 16, active | Whether it exists and where |
| Nursery, Pre-Kindergarten | In the age table, not in the dropdown | Active, pre-school campuses only | That they are offered |
| Which grades each campus offers | Dropdown unfiltered by campus | Pre-schools: Nursery–Pre-Reception; Broadhurst: Reception–Stage 6; Block 7: Reception–Form 5 | The whole matrix at `/staff/admin/grades` |
| Potch — CBD Maury Avenue | Listed as a campus | Seeded **inactive**, country BW | Country (ZA?), currency, what it offers |
| Term dates 2026–2027 | Not on the site | Approximate | Real dates at `/staff/admin/intakes` |
| Age cut-off | "before end July" | 31 July of the academic year | — |
| Assessment exemption | "Reception through to Secondary … assessment" | Nursery–Pre-Reception exempt | — |

## 5. Open items, roughly by priority

1. **Is Potch in South Africa?** Drives currency (ZAR), POPIA, and the payment
   provider. The schema is ready either way (`campuses.country/currency`).
2. **Email provider and sending domain** with SPF, DKIM, DMARC. Set
   `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `RESEND_WEBHOOK_SECRET`, and point Resend's webhook at
   `/api/webhooks/email`. The adapter has not been run against the live API.
3. **Brand assets.** The palette in `web/app/globals.css` is a placeholder in
   the right family; swap the brand tokens once real colours arrive.
4. **First super admin.** See `supabase/README.md`. Until one exists nobody
   can sign in to `/staff`.
5. **Publish sessions.** Parents cannot book until a session is published at
   `/staff/admin/sessions`.
6. **Payment provider** (Phase 3, but merchant onboarding is slow — start now).
   Candidates: DPO/PayGate, Flutterwave, FNB/Stanbic gateway, Orange Money,
   MyZaka; EFT with proof-of-payment regardless.
7. **Admission thresholds, question bank authorship, written-language marking
   policy** (Phase 2). Not for engineering to invent.
8. **Data protection**: Botswana DPA 2018 (and POPIA if Potch is ZA) — consent
   wording, retention for declined/abandoned applicants, cross-border
   disclosure (Vercel, Supabase, AI provider).
9. **WhatsApp** is the dominant channel in Botswana and is Phase 4 by the
   spec; worth deciding deliberately whether reminders move earlier.
10. **Antivirus scanning on uploads** (Phase 3) is not designed yet.
11. **Generated Supabase types** to replace the hand-maintained file.
12. **Playwright smoke test** of the funnel on a phone viewport, timed.

## 6. Working style that worked

- Replay the migrations from empty after every schema change
  (`supabase/tests/replay_local.sh`). It caught two bugs before any code ran.
- Write the SQL functions, then smoke-test them with `psql` before writing
  the TypeScript that calls them.
- Typecheck after every batch of files, not at the end.
- Say what is untested. The Resend adapter and the Supabase invite flow are.
