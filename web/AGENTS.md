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
must not join `question_answers`. The DTO type has no field for an answer; keep
it that way.

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
