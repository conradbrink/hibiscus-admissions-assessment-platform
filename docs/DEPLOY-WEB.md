# Deploying the web application

Vercel, auto-deploying from `main`. CI (`.github/workflows/ci.yml`) is the
gate in front of `main`; Vercel's GitHub integration does the deploy, so no
deploy token lives in GitHub.

## One-time set-up

### Supabase

1. Create a project (region: closest to Botswana that Supabase offers).
2. Put the project ref in `supabase/config.toml`.
3. Apply the migrations: `supabase link --project-ref <ref>` then
   `supabase db push`. Verify with `supabase migration list` that every file
   in `supabase/migrations` is recorded.
4. Create the first super administrator — see `supabase/README.md`.
5. In Authentication → URL configuration, set the site URL to the production
   domain and add `https://<domain>/staff/reset-password` to the redirect
   allow-list. Invitations and password resets land there.

### Vercel

1. Import the repository. **Root directory: `web`.**
2. Environment variables, from `web/.env.example`:

| Variable | Secret? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Grants nothing on its own |
| `NEXT_PUBLIC_SITE_URL` | Public | `https://<domain>`, used in emailed links |
| `NEXT_PUBLIC_SENTRY_DSN` | Public | Optional |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Bypasses RLS. Rotate immediately if exposed |
| `PARENT_SESSION_SECRET` | **Secret** | `openssl rand -base64 32` |
| `CRON_SECRET` | **Secret** | Vercel sends it to `/api/jobs/drain` |
| `EMAIL_PROVIDER` | | `dev` until the domain is verified, then `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | **Secret** | |
| `AI_PROVIDER` | | `dev` (deterministic wording, no key) or `anthropic` |
| `ANTHROPIC_API_KEY` | **Secret** | Only read when `AI_PROVIDER=anthropic` |
| `AI_MODEL` | | Optional; defaults to `claude-opus-5` |
| `PAYMENT_PROVIDER` | | `dev` (charges nothing, cannot say "paid" on its own, refuses to load in production) or `dpo` |
| `DPO_COMPANY_TOKEN`, `DPO_SERVICE_TYPE` | **Secret** | From the DPO Pay merchant portal; only read when `PAYMENT_PROVIDER=dpo` |
| `DPO_API_URL` | | Defaults to live; the sandbox is `https://secure1.sandbox.directpay.online/API/v6/` |
| `DOCUMENT_SCANNER` | | `none` until a scanner is implemented |
| `DOCUMENT_EXTRACTOR` | | `none`, or `anthropic` to read birth certificates and reports through the AI provider (also needs the `ai_extraction_enabled` setting) |
| `STUDENT_SYSTEM` | | `none`; the student export under Enrolment is the integration until Ed-admin's API is known |
| `MESSAGING_PROVIDER` | | `dev` (records, sends nothing) or `meta` for WhatsApp through Meta's Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | **Secret** | From Meta Business Manager; only read when `MESSAGING_PROVIDER=meta` |
| `WHATSAPP_API_URL` | | Optional; defaults to the Graph API version in `lib/messaging/meta.ts` |

⚠️ **Never prefix a secret with `NEXT_PUBLIC_`.** Anything with that prefix is
compiled into the JavaScript every visitor downloads.

3. `vercel.json` registers the cron (`/api/jobs/drain` every five minutes).
   Confirm it appears under the project's Cron Jobs after the first deploy.
   The drain is also what runs the delayed jobs — a timed-out sitting's
   auto-submit, offer reminders and offer expiry — and, from Phase 4, the
   payment sweep, waitlist promotion, the daily retention run, the morning
   digest and the WhatsApp companions, so a stalled cron delays all of them
   until it next fires.
4. Custom domain and HTTPS.

### Payments

Set `PAYMENT_PROVIDER=dpo` only on production, with the live DPO token and
service type. Preview deployments keep `dev`: the `/pay/dev` screen stands in
for the gateway and nothing is charged. DPO sends no signed webhook; the site
verifies each payment with DPO when the parent returns and again from the
cron every few minutes until it is paid or its time limit passes, so the
cron must be running for payments to confirm without the parent's browser.
Enter the bank details for transfers under **Set up → Fees**.

### Documents

Uploaded documents go into a private Storage bucket named
`applicant-documents`, created by the application on first use with the
service role; no Storage policies are needed because only the service role
ever reads or writes an object. Uploads are capped at 10 MB server-side. If
the Vercel plan's request-body limit is lower, a signed-upload-URL flow
replaces the upload route (the seam is `storeDocument`).

### WhatsApp

Leave `MESSAGING_PROVIDER=dev` until the school has a WhatsApp Business
Account and a verified number. Then set the four Meta variables, register
`https://<domain>/api/webhooks/whatsapp` in Meta's app dashboard (the GET
handshake answers with the challenge for `WHATSAPP_VERIFY_TOKEN`; every POST
is verified against `WHATSAPP_APP_SECRET`), subscribe the app to the
`messages` field, and submit the templates for approval. Nothing is sent
until the `whatsapp_enabled` setting is on, a template is active, and the
parent opted in.

### Email

Verify the sending domain in Resend and publish its SPF, DKIM and DMARC
records **before** switching `EMAIL_PROVIDER` to `resend`. Add a webhook in
Resend for delivered / opened / clicked / bounced / complained events, pointed
at `https://<domain>/api/webhooks/email`, and put its signing secret in
`RESEND_WEBHOOK_SECRET`.

## Deploying a change

Branch → pull request → CI green → merge to `main`. Vercel builds a preview
for every PR and promotes `main` on merge. Nothing is deployed from a laptop.

## Rolling back

1. Vercel → Deployments → the last good one → **Promote to Production**.
2. `git revert` the merge on `main`, so the next unrelated merge does not
   silently re-deploy the broken build on top of the rollback.

A rollback does not undo migrations. New migrations must be backward
compatible with the previous deploy for the minutes between them.

## Health checks after a deploy

- `/join` renders and the three buttons work.
- `/staff/login` signs in and the dashboard loads.
- `/staff/admin/jobs` shows the queue draining (nothing stuck in `running`).
- A test enquiry with `EMAIL_PROVIDER=dev` appears in `/staff/admin/dev-outbox`
  with a working link.
