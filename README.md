# Hibiscus Admissions & Assessment Platform

The admissions system for Hibiscus Schools: from a parent's first enquiry on
the website, through assessment booking, assessment, decision, offer, payment
and registration, to enrolment.

**Read `docs/PROJECT-CONTEXT.md` first** if you are new here. It records the
decisions, what the school still needs to confirm, and what has been built.

## The idea in one paragraph

The old form asked a parent forty questions and three documents before the
school knew whether it could offer a place. This system asks eight, books an
assessment in about two minutes, and only collects the rest after an offer has
been accepted and paid for. Parents never create an account: every email
carries a personal link. Staff see a pipeline, a timeline per applicant, and a
task list; the system moves applicants between stages itself and asks a human
only where judgement is needed.

## Layout

| Path | What |
|---|---|
| `web/` | Next.js 16 application: the parent funnel (`/join`, `/next`), the staff console (`/staff`), route handlers (`/api`) |
| `web/lib/workflow/` | The state machine and the engine — the only writer of an application's status |
| `web/lib/email/` | Templates, rendering, the provider seam (`dev` and Resend) |
| `web/lib/tokens/` | Magic links and the parent session cookie |
| `web/lib/assessment/` | The question bank's answer keys, form materialisation, marking and scoring, the kiosk session |
| `web/lib/rules/`, `web/lib/profile/`, `web/lib/ai/` | The admission rules engine, the learning profile with its validated AI narrative, and the AI provider seam |
| `web/lib/offers/` | Fee snapshots and offer rendering |
| `web/lib/payments/` | The gateway seam: DPO Pay adapter, a dev adapter, checkout, the reconciler that is the only path to "paid" |
| `web/lib/registration/`, `web/lib/documents/`, `web/lib/enrolment/` | Registration schemas and the completeness rule, document storage and sniffing, the enrolment record and the student-system seam |
| `web/lib/messaging/` | The WhatsApp seam: Meta Cloud API adapter, a dev adapter, the companion sender, replies |
| `web/lib/summary/`, `web/lib/analytics/` | Applicant facts and flags with optional validated prose; the funnel, breakdown and forecast arithmetic |
| `web/lib/workflow/automation/` | Waitlist promotion, data retention, the morning digest, and the pure rules behind them |
| `web/app/(kiosk)/` | `/sit`: what a child sees on the lab computer |
| `web/app/(parent)/{offer,pay,register}/` | Accept the offer, pay the fees, complete registration |
| `supabase/seed/` | `dev_phase2.sql`: a labelled sample bank, template, fee schedule and draft ruleset for development databases only |
| `supabase/migrations/` | The schema, replayable from empty |
| `supabase/tests/` | `replay_local.sh` rebuilds a local database; `security_regression.sql` attacks it |
| `docs/` | Project context, deployment, runbook |

## Running it

```sh
cd web
cp .env.example .env.local      # fill in Supabase URL, publishable key, service-role key, PARENT_SESSION_SECRET; AI_PROVIDER=dev needs no key
npm install
npm run dev                     # http://localhost:3000
```

With `EMAIL_PROVIDER=dev` (the default) no email is sent; every message is
readable at `/staff/admin/dev-outbox`, links included, which is how the whole
parent journey is walked on a laptop.

To get a database: create a Supabase project, run the migrations with the
Supabase CLI (`supabase db push`), then create the first staff account — see
`supabase/README.md`. On a development database, `supabase/seed/dev_phase2.sql`
adds a sample question bank and template so an assessment can be sat without
authoring one first.

## Checks

```sh
cd web
npm run typecheck
npm run lint            # blocking in CI
npm test                # unit tests for the pure domain modules
npm run build
```

```sh
su postgres -c "supabase/tests/replay_local.sh"   # rebuilds a local Postgres from the migrations and runs the security suite
```

## Rules that are not obvious from the code

- **Parents are not database principals.** There is no parent RLS. Every
  parent-facing read runs under the service role after a token has been
  verified, scoped to one application id. See `web/AGENTS.md`.
- **`applications.status` has one writer**, `commit_transition()`. Staff
  clients are refused UPDATE on that column by grant.
- **No email wording in code.** Templates live in the database; staff edit
  them at `/staff/admin/templates`. Offer wording lives in `offer_templates`.
- **Answers never leave the server.** The kiosk reads the frozen form only;
  answer keys are readable by content authors and the marker, nobody else,
  and a unit test greps the delivery code for the key tables.
- **A payment is "paid" only when the gateway confirms it server-side** with the
  amount and currency we asked for, or when finance records a bank receipt.
  Nothing on the return URL is trusted, and the dev adapter cannot say "paid"
  on its own.
- **Every school's team sees its own school.** Campus scoping is in the
  policies, fails closed for campus-scoped roles, and binds staff actions as
  well as pages.
- **The AI never decides.** Admission outcomes come from the rules engine or
  a person. The AI writes the learning-profile narrative over numbers the
  code computed, and a validator rejects any sentence that adds a number,
  diagnoses or ranks; the deterministic wording is used instead.
- **A WhatsApp message is an approved template** sent beside an email to a
  parent who opted in; there is no free text, and the engine does not know
  the channel exists.
- **Document extraction proposes, the parent confirms.** A reading never
  writes a registration field; a disagreement is a flag on the form and a
  task for a person.
- **Every automation ships off**, behind a setting, and runs from the cron
  drain idempotently. Retention removes personal data through one database
  function, after a preview, and keeps the analytics row.
- **The parent signs the school's own words.** The four policy documents are
  the agreement bodies, verbatim, with the PDFs served by the site; the
  signature is drawn, validated and rendered on the server, and stored with
  the version and hash of what was signed.
- **Migrations are never edited once applied.** CI blocks it.
