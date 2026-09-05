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
| `supabase/migrations/` | The schema, replayable from empty |
| `supabase/tests/` | `replay_local.sh` rebuilds a local database; `security_regression.sql` attacks it |
| `docs/` | Project context, deployment, runbook |

## Running it

```sh
cd web
cp .env.example .env.local      # fill in Supabase URL, publishable key, service-role key, PARENT_SESSION_SECRET
npm install
npm run dev                     # http://localhost:3000
```

With `EMAIL_PROVIDER=dev` (the default) no email is sent; every message is
readable at `/staff/admin/dev-outbox`, links included, which is how the whole
parent journey is walked on a laptop.

To get a database: create a Supabase project, run the migrations with the
Supabase CLI (`supabase db push`), then create the first staff account — see
`supabase/README.md`.

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
  them at `/staff/admin/templates`.
- **Migrations are never edited once applied.** CI blocks it.
