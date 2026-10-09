# Deploying the HR app

## 1. The database

The HR migrations are in `supabase/migrations/` with the admissions ones
(`20261012…_hr_*.sql`) and are applied the same way:

```sh
supabase link --project-ref <ref>
supabase db push
```

Then rehearse locally, as for any schema change:

```sh
su postgres -c "supabase/tests/replay_local.sh"
```

It replays every migration and runs the admissions suite, the HR suite
(`hr_security_regression.sql`) and template coverage.

## 2. A Vercel project

| Setting | Value |
|---|---|
| Root Directory | `hr` |
| Framework | Next.js |
| Domain | e.g. `careers.<school domain>` or `hr.<school domain>` |
| Ignored Build Step | `git diff --quiet HEAD^ HEAD -- hr supabase` (so an admissions-only change does not redeploy HR) |

Environment variables are listed, with what each is for, in
`hr/.env.example`. Give HR its **own** Supabase secret key,
`HR_SESSION_SECRET` and `CRON_SECRET`, different from admissions'.

## 3. Email

In Resend, verify the sending address in `EMAIL_FROM` (for example
`careers@`), add a webhook to `https://<hr site>/api/webhooks/email` for the
`email.*` events, and put its signing secret in `RESEND_WEBHOOK_SECRET`. Then
set `EMAIL_PROVIDER=resend`. Until then every email is recorded in
`hr_email_messages` and nothing is sent.

## 4. The job queue

Reference emails, reminders, AI marking and the AI-writing check run from the
HR job queue. Three schedules call `/api/jobs/drain`, so nothing waits long if
one stops:

1. **Supabase pg_cron, every five minutes.** In the SQL editor, once:
   ```sql
   select vault.create_secret('https://<hr site>/api/jobs/drain', 'hr_drain_url');
   select vault.create_secret('<the HR CRON_SECRET>', 'hr_drain_cron_secret');
   ```
2. **GitHub Actions, hourly**: repository secrets `HR_DRAIN_URL` and
   `HR_CRON_SECRET` (`.github/workflows/hr-drain.yml`).
3. **Vercel cron, nightly** (`hr/vercel.json`).

## 5. AI

Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. With `dev`, nothing is
marked by AI (a person marks every answer) and the AI-writing check reports
"Not checked"; the duplicate-answer check still runs. Both can be switched off
in `hr_settings` (`ai_marking_enabled`, `ai_integrity_enabled`).

## 6. Giving staff access

HR roles are assigned to existing staff accounts in the admissions console,
under Staff and roles: **HR manager**, **HR staff**, **Payroll officer**, or
**Interviewer** (campus-scoped, read only, for principals on a panel). A
super administrator holds every HR permission **except pay**: salaries and
payslips need the HR manager or payroll officer role.

## Before going live

- The school confirms the careers page wording marked `confirm: true` in
  `hr/content/careers.ts`, and the privacy notice on the vacancy page.
- The school confirms the retention periods and scoring weights
  (`hr_settings`).
