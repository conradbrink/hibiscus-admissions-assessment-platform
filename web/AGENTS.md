<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Rules for this application

Read `../docs/PROJECT-CONTEXT.md` first. The rules below are the ones that
cannot be inferred from the code.

## Parents are never database principals

There are no parent accounts and no parent JWTs. A parent reaches their
application through a magic link (`/a/<token>`), which is exchanged once for a
short-lived signed cookie scoped to exactly one application. Every parent-facing
read and write then runs through the **service-role client** in
`lib/supabase/admin.ts`, inside a route handler or server action, after
`lib/tokens` has verified the cookie.

That means:

- `lib/supabase/admin.ts` is `server-only`. Importing it from a client component
  is a build error, and it must stay that way.
- Parent-facing code **must** scope every query by the `application_id` from the
  verified session. There is no RLS backstop for parents. A missing `.eq()` is a
  data leak across families.
- Never put an application id, a reference, or a token in a query string.

## Only the workflow engine writes `applications.status`

`lib/workflow/engine.ts` is the single writer. Everything else raises an event
and lets the engine project the status. If you find yourself writing
`.update({ status })` anywhere else, stop.

## No wording in code

Every email a parent receives is rendered from `email_templates`. Offer wording
will come from `offer_templates`. If a string is going to be read by a parent in
an email or a document, it belongs in the database where an administrator can
change it.

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
come from `lib/rules/evaluate.ts` or a person's recorded decision. Do not add
an AI call that writes a mark, an outcome, or anything a parent reads without
that validator in front of it.

## Snapshots, not references

An attempt sits a frozen form (`form_questions`), an offer is the HTML and
fees rendered at approval (`offers.rendered_html`, `offers.fees`), a decision
records the inputs it read. Editing a question, a template, a fee schedule or
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
