<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Rules for the HR app

The HR app is a separate application on the admissions database. It shares
staff accounts, roles and campuses with admissions, and nothing else. Read
`../docs/hr/README.md` first. These are the rules that cannot be inferred
from the code; they mirror `../web/AGENTS.md` where the problem is the same.

## Separate from admissions

- Every table HR writes is prefixed `hr_`. HR has its own audit log
  (`hr_audit_log`), job queue (`hr_jobs`), email templates and messages, magic
  links (`hr_access_tokens`) and storage bucket (`hr-documents`). Never write
  to an admissions table, and never queue an `hr_` job in `jobs`: the
  admissions drain claims every row there and fails unknown types.
- `lib/supabase/types.ts` lists only the tables HR touches. Reaching for an
  admissions table should fail to compile.
- Code shared with admissions (email, AI provider, tokens, rate limits,
  security headers) is **copied** into `hr/lib`, with a note saying so. Keep
  the two in step when fixing a bug in either. When a third app needs them,
  move them into a shared package instead of copying a third time.

## Applicants and referees are never database principals

They reach the app through a magic link (`/h/<token>`, `/r/<token>`) that is
exchanged once for a signed cookie: `hbs_hr_applicant` or `hbs_hr_referee`,
signed under different HMAC domains so neither can be read as the other.
Everything they read and write runs under the service role, scoped by the id
in the verified cookie.

- Applicant pages read only through `lib/applicant/scope.ts` and write only
  through `lib/applicant/save.ts`, which take the session, never a raw id.
  `lib/applicant/scope.test.ts` fails if anything under `app/(applicant)` or
  `app/(referee)` queries a table itself.
- Never put an application id, a reference request id or a token in a query
  string on an applicant or referee page.

## Only the engine writes the stage

`hr_applications.stage` (Review / Shortlisted / Unsuccessful) is written by
`submitApplication` (the first stage) and by `hr_commit_stage()` through
`lib/recruitment/engine.ts`, a compare-and-set on the stage the person saw.
If you find yourself writing `.update({ stage })` anywhere else, stop.

## A person decides, and a person clicks before bad news

- The AI drafts questions (a person approves each one), suggests a band for
  each answer (a person's band replaces it), and flags possible AI-written
  answers. It never moves an application, rejects anyone or touches pay.
  Every call goes through `lib/ai/provider.ts`; nothing else imports a vendor
  SDK.
- **Flags never change the score.** A safeguarding concern, a missing
  registration or a possible AI-written answer is a red or amber line for a
  person to read, never points off. `lib/scoring/score.test.ts` asserts it.
- The AI-writing check runs for every submitted application and is evidence,
  not a verdict: detectors are often wrong about people writing well in a
  second language. The applicant is told about it before the questions open.
- Moving a card does not email anyone unless the person ticks "Email the
  applicant". The unsuccessful and offer emails are only ever a click.

## Answers and rubrics never leave the server

Applicant pages receive a question's prompt and word limit, never its rubric,
and never a band, a rationale, an AI likelihood, a score or a reference. The
types in `lib/applicant/scope.ts` have no field for them; keep it that way.

## Pay is stricter than admin

`has_permission()` answers yes to every code for `admin`. Salaries, bank
details and payslips are guarded by `hr_has_strict()`, which does not, and
`STRICT_CODES` in `lib/permissions.ts` makes the screens agree. Do not
"simplify" either back.

Payroll is worked out only by `lib/payroll/calculate.ts`, a pure function in
integer minor units, from a **published** tax table. Two people are needed:
the database refuses the preparer as approver, and freezes an approved run
and a published tax year. A correction goes into the next month's run, never
into an approved one. Stored copies of emails have magic links removed
(`lib/email/redact.ts`), so a payslip link is never readable by staff.

## No wording in code, in plain English

Every email an applicant, referee or employee receives is a row in
`hr_email_templates`, at CEFR B1 to B2 (the rules in `../web/AGENTS.md`).
No em dashes in anything a person outside the school reads. The careers page
words live in `content/careers.ts`; items marked `confirm` need the school's
sign-off.

## Documents go through one door

Bytes are stored only by `adoptUploadedObject` (sniffed, capped, hashed, at a
path with no user-controlled segment) and read only through
`/staff/documents/[id]`, which selects the row under RLS, audits the opening
and redirects to a one-minute signed URL.

## Retention through one function

`hr_anonymise_applicant()` is the only remover, called only by
`lib/retention.ts` from the drain. Every new table holding an applicant's
personal data must be added to it. It refuses a hired applicant.

## Migrations

Same rules as `../supabase/README.md`: 14-digit name, never edit an applied
file, `security invoker` RPCs, `(select …)` in policies, EXECUTE revoked from
`public, anon`, nothing in `storage.*`, idempotent DDL. Update
`lib/supabase/types.ts` in the same commit, and add a case to
`../supabase/tests/hr_security_regression.sql` for every new table.
