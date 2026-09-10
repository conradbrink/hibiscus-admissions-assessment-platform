<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Rules for this application

Read `../docs/PROJECT-CONTEXT.md` first. The rules below are the ones that
cannot be inferred from the code.

## Parents are never database principals

There are no parent accounts and no parent JWTs. A parent reaches us through a
magic link (`/a/<token>`), which is exchanged once for a short-lived signed
cookie. Every parent-facing read and write then runs through the
**service-role client** in `lib/supabase/admin.ts`, inside a route handler or
server action, after `lib/tokens` has verified the cookie.

There are two such cookies, and they are deliberately separate:

- `hbs_parent`, scoped to **one application**, path `/`. The funnel: booking,
  results, the offer, payment, registration.
- `hbs_family`, scoped to **one family**, path `/family`. The CRM: every child
  at once, for as long as the family is with the school.

The family cookie is an amendment, agreed with the school on 10 September
2026. The rule used to say a parent session named exactly one application,
which was right for a two-month funnel about one child and wrong for a family
of eight years and three children: everything the CRM asks — finish the
checklist, confirm your details, is she coming back — is asked of the family,
not of an application that closed years ago.

That means:

- `lib/supabase/admin.ts` is `server-only`. Importing it from a client component
  is a build error, and it must stay that way.
- Parent-facing code **must** scope every query by the id from the verified
  session. There is no RLS backstop for parents. A missing `.eq()` is a data
  leak across families — and under a family session it leaks somebody else's
  children, so **every read under `app/(parent)/family` goes through
  `lib/family/scope.ts`**, which takes the session and never a raw id.
  `scope.test.ts` fails the build if a family route queries a table itself.
- The two cookies are signed under **different HMAC domains**, so a bug in one
  decoder cannot promote a funnel cookie into a family one, or the reverse.
  Do not collapse them into a single cookie carrying a subject field.
- A token names exactly one subject, and its purpose decides which: the
  database enforces it in `access_tokens_subject_check`.
- Never put an application id, a family id, a reference, or a token in a query
  string.

## Only the workflow engine writes `applications.status`

`lib/workflow/engine.ts` is the single writer. Everything else raises an event
and lets the engine project the status. If you find yourself writing
`.update({ status })` anywhere else, stop.

## No wording in code

Every email a parent receives is rendered from `email_templates`. Offer wording
will come from `offer_templates`. If a string is going to be read by a parent in
an email or a document, it belongs in the database where an administrator can
change it.

## Plain English for parents

Everything the platform writes to a parent is at CEFR level B1 to B2:
the offer letter, every email and WhatsApp message, the assessment
report, the learning profile, and the parent pages. The rules, which the
AI prompts also carry (`PLAIN_ENGLISH_RULES` in `lib/profile/narrative.ts`):

- Short sentences, 10 to 20 words. One idea per sentence.
- Common words: use, not utilise; help, not facilitate.
- Active voice: "The school invoices tuition", not "Tuition is invoiced".
- No idioms, no slang, nothing that only makes sense in one country.
- Be direct. No filler, no corporate language.
- Explain a technical word in the same sentence if it cannot be avoided.
- One word for one thing: "assessment", never also "test" or "exam".
- International formats: 21 September 2026, P 5,300.00.
- Write for someone whose English is their second or third language.

Staff-facing text may be denser, but the same rules make it better.

## Answers never leave the server

Anything under `lib/assessment/` that builds a delivery payload for the kiosk
must not join `question_answers` or `form_answer_keys`. The DTO type in
`lib/assessment/delivery.ts` has no field for an answer; keep it that way.
`delivery.test.ts` greps the delivery code and the kiosk routes for both table
names and fails if either appears. Marking runs under the service role in
`lib/assessment/mark-attempt.ts`; the assessor's page shows the child's
answer and the rubric descriptors, never the key.

## The kiosk is its own principal

A lab computer opens a sitting with a single-use code and holds a `hbs_sit`
cookie signed with a different HMAC domain from the parent cookie, scoped to
`/sit` and `/api/sit`. Kiosk routes use the service role after
`lib/assessment/kiosk-server.ts` has verified that cookie, and scope every
query by the attempt id in it. The server clock is the timer: the RPCs
refuse a response after `expires_at` plus the grace setting, whatever the
browser's countdown said.

## The AI never decides

`lib/ai/provider.ts` is the only seam; nothing else imports a vendor SDK. The
AI writes the learning-profile narrative from numbers `lib/profile/compute.ts`
produced, and `lib/profile/narrative.ts` validates the result: any number not
in the computed set, any banned term, or the child's surname, and the
deterministic fallback is stored instead, with the reason. Admission outcomes
come from `lib/rules/evaluate.ts` or a person's recorded decision. One
exception, on the school's instruction of 7 September 2026: with
`ai_auto_mark_enabled` and a real provider, `lib/ai/auto-mark.ts` marks
written answers against the question's rubric (`marking_method = 'ai'`), the
band and rationale are shown on the attempt page, and a person's mark
overrides it. Do not add any other AI call that writes a mark, an outcome, or
anything a parent reads without a validator in front of it.

## Paid means verified

A payment row reaches `succeeded`, and an application reaches `paid`, only
through `reconcilePayment` in `lib/payments/reconcile.ts` (a server-side
verify whose amount and currency equal the row) or through `onEftRecorded`
(a receipt a member of finance is accountable for). The gateway's return
URL carries nothing we trust; the query string is at most a hint about
which payment to verify first. The dev adapter cannot report "paid" unless
the non-production simulate screen wrote the outcome. Do not add a path
that sets a payment status from a request.

## Documents go through one door

Bytes are stored only by `storeDocument` (sniffed, capped, hashed, path
without a user-controlled segment) and read only through the staff route
that first selects the `documents` row under RLS and then mints a
one-minute signed URL. The bucket is private and has no policies; nothing
but the service role touches it. Never hand a storage path or URL to a
parent page.

## A message is an approved template

`lib/messaging/provider.ts` is the only seam; nothing else imports a vendor
API. WhatsApp messages are sent only by `sendCompanionMessage`, only as a
`message_templates` row that names a Meta-approved template, only to a
contact with `whatsapp_opt_in`, and only as the companion of an email moment
(or by hand from the applicant page, still a template). Do not add a path
that sends free text, and do not teach an engine action about the channel:
`handlers/send-email.ts` queues the companion.

## Extraction proposes, the parent confirms

A document reading is written to `documents.extracted_fields` and, when it
disagrees with the form, to `registrations.mismatch_flags` and a task. It
must never write a registration field; `saveStudent` clearing the flags is
the parent's confirmation. Medical documents are never sent to a model. The
summary on the applicant page follows the same rule: `lib/summary/facts.ts`
computes the facts and flags, the model may only write prose over them, and
`validateSummary` decides whether that prose is kept.

## Retention deletes through one function

`anonymise_application()` in the database is the only thing that removes
personal data, and `lib/workflow/automation/retention.ts` is the only thing
that calls it, after deleting the stored files. Do not add a delete of an
applicant row anywhere else; if a new table holds personal data, add it to
the function and to the security suite's check 37.

## A student outlives their application

`applications` is how a child arrived; `students` is who they are. The
pipeline still ends at `enrolled` and `commit_transition()` is still the only
writer of `applications.status` — the CRM starts where the funnel stops
rather than extending its graph.

That means two things when you touch these tables. A student's read policy
asks their own `current_campus_id`, not an application's, because the
application may be anonymised, deleted or a decade old; the column is
maintained by `enrolments_sync_student_placement` and nothing else should
write it. And `students` has no insert policy: a child is created by
`promoteToStudent` at enrolment, under the service role, from a registration
a person already checked. Typing one straight into the register would skip
every one of those checks.

`anonymise_application()` refuses an application a student was enrolled from
(`applications_refuse_anonymise_enrolled`). If a new CRM table holds personal
data, it belongs in the retention story before it ships, not after.

## Snapshots, not references

An attempt sits a frozen form (`form_questions`), an offer is the HTML and
fees rendered at approval (`offers.rendered_html`, `offers.fees`), an
acceptance hashes what was on the screen, a payment request copies the fees
owed, a decision records the inputs it read, and a student record freezes
the registration at enrolment. Editing a question, a template, a fee schedule or
an offer template after the fact must never change what a child saw, what a
parent was offered or why a decision was made. Read from the snapshot when
showing history.

## Style

- Files kebab-case; components PascalCase named exports; `page.tsx` default.
- Domain modules in `lib/` are plain async functions taking the Supabase client
  as their first argument. They `throw new Error(error.message)`; the caller
  catches.
- `.select()` takes a single string literal — a concatenated string degrades to
  `GenericStringError` in postgrest-js.
- Every ESLint suppression carries a written reason on the line above it.
- Comments explain *why*, and name the bug that motivated them where there was
  one. British English.

- **A paper's content lives in `web/content/papers`, not in the database by hand.** Edit the JSON, re-run `web/scripts/paper-seed.mjs`; the seed upserts by question code so a sitting already taken is untouched. Licensed material (Cambridge) is served only through `/api/sit/media` behind a sitting or a staff session.

- **A mobile number is asked for as a country plus a number, and stored in E.164.** `lib/phone.ts` owns the rules and every form uses `MobileInput`; `mobileNumber`/`optionalMobileNumber` in `lib/validation.ts` run the same check on the server. Nothing else should hand-roll a phone regex, and nothing should store a number WhatsApp cannot reach.
- **Deleting an applicant is the exception, not a tool.** `delete_application()` is service role only and gated on `applications.delete`, which only the super administrator holds; withdrawing keeps the record, `anonymise_application()` removes the person and keeps the figures. Deleting is for records that should never have existed, and leaves one audit row behind.
- **Every value in a constrained Ed-admin column comes from `web/content/enrolment/ed-admin-codes.json`.** Their importer matches the exact string and drops anything else silently — a grade of `Stage 5` rather than `Stage5-HPS` imported the child and lost the family. Stage names are per campus and live in `campus_grades.external_grade_code`, edited in Settings, never derived in code.
- **A messaging provider is chosen by `MESSAGING_PROVIDER` and nothing outside `lib/messaging` knows its name.** `dev` records and delivers nothing, `zavu` is the live one, `meta` is WhatsApp's Cloud API and `twilio` is Twilio. A provider declares which `message_templates` column carries its handle for a template (`templateIdField`); the send path skips a template that has not been given it, and never sends half-configured. Twilio signs the webhook URL as well as the body, which is why `verifyWebhook` takes one.
