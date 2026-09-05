# Runbook

For whoever is on the phone when something is wrong. Plain language; the
engineering detail is in `PROJECT-CONTEXT.md`.

## A parent says their link does not work

1. Ask for the reference (`HBS-2026-00482`) — it is at the top of every email.
2. Open the applicant in the console. The **Parent** panel shows when the last
   link was sent and until when it is valid.
3. Press **Email a fresh link**. If they are on the phone now, press
   **Generate link to share** and read it out or send it by WhatsApp. It is
   valid for two weeks.
4. Links stop working after their expiry, after being used the maximum number
   of times, or when the parent's session cookie times out after an hour of
   inactivity. All three send the parent to a page that explains and offers a
   new link. None of them is a bug.

## A parent says they never got the email

1. Applicant → **Emails**. Every send is listed with its status.
2. `queued` for more than ten minutes: the job drain is not running. Check
   `/staff/admin/jobs`; press **Run pending now**. If jobs stay `pending`,
   the Vercel cron is not firing — check `CRON_SECRET` is set.
3. `failed`: open the message; the error is shown. A bad address is the
   parent's to fix; a provider error is ours.
4. `sent` but not received: ask them to check spam. If this is common, the
   sending domain's SPF/DKIM/DMARC records are wrong.
5. `bounced`: the address does not exist. Phone them.

## Nobody can book

Parents can only book **published** sessions at **their** campus for **their**
grade with **places left**. `/staff/admin/sessions` shows all four. The most
common cause is that nothing has been published for next month yet.

## A no-show was marked by mistake

The parent has been emailed a rebooking link. Book them back into the same
session from the applicant page (**Book selected**) — the no-show stays in
the timeline as a record, which is correct.

## The assessment computer will not open a child's sitting

1. Codes last fifteen minutes (**Workflow settings → kiosk_code_minutes**)
   and work once. Press **Launch** again on the check-in board: the old code
   is retired and a new one shown, with a QR code the lab tablet can scan.
2. The page at `/sit` says whether a code has expired or is not recognised
   (a code that has already been used is not recognised again). Neither
   loses the child's answers — every answer is saved as it is given.
3. If the child's browser closed mid-sitting, open `/sit` on the same
   computer: the sitting resumes at the next unanswered question with the
   clock still running. On a different computer, launch again from the board.

## A child ran out of time

The sitting is submitted automatically at the time limit (plus a short
grace period) and marked as **auto-submitted** on the attempt page. Unanswered
questions score zero. If a child needs more time for a known reason, set the
**time multiplier** in the Launch dialog *before* they start; it is recorded
on the attempt so the assessor can see it.

## The learning profile has not appeared

1. Applicant → **Assessment** tab. If the sitting shows **awaiting rubric**,
   the writing item is waiting for an assessor: open the attempt and mark it.
   Nothing after that point (scores, decision, profile, offer) happens until
   the writing is marked. This is deliberate.
2. Once marked, the profile and the decision are queued together. If they do
   not appear within a few minutes, `/staff/admin/jobs` shows the failed job
   and its error.
3. The **Profile** tab says whether the wording is the AI's or the standard
   fallback, and why. A profile that says "AI text failed validation" is not
   broken: the validator refused a sentence and the safe wording was used.

## An offer cannot be approved

- **"Waiting for profile"**: see above. The results email links the profile,
  so an offer is never sent without one.
- **"No active fee schedule"**: `/staff/admin/fees` needs an active schedule
  for that campus, academic year and grade. Activate one, then press
  **Generate offer** on the applicant. Finance owns the amounts.
- **No active offer template**: `/staff/admin/offer-templates` — publish a
  version.

## An offer went out with a mistake

**Withdraw & re-draft** on the applicant's **Offer** tab or the Offers page.
The parent's offer link stops working immediately, the reminders for that
offer skip themselves, and a corrected offer can be generated and approved.
The withdrawn offer stays in the applicant's history with the reason given.

## The dashboard counts look wrong

They are computed live from the same rows the pipeline shows; if the pipeline
is right, the counts are right. Campus-restricted staff see only their
campuses in both.

## Setting up a school's admissions team

`/staff/admin/staff`. Invite each person with the **Campus administrator**
role and tick their campus under **Limit to campuses**; a campus
administrator with no campus ticked sees nothing at all, and the form refuses
to save that. The person who approves offers and decides reviews for that
school gets **Admissions manager** with the same campus limit. Head-office
staff have no campus limit and see every school. Every list, count and
report in the console follows the same rule automatically.

## Somebody left, or joined

`/staff/admin/staff`. Untick **Can sign in** to remove access at once —
their sessions end on the next request. Nothing they did is deleted; the audit
trail keeps their name.

## Something is genuinely broken

- Sentry (if configured) has the error with a reference number; the parent's
  error page shows the same number.
- Vercel → Deployments → promote the previous deployment. See `DEPLOY-WEB.md`.
- Nothing a parent typed is lost by a rollback: applications live in the
  database, not in the deployment.

## Things never to do in production

1. Never edit a row in `audit_log`, `application_events` or `email_messages`.
   They are the record.
2. Never change `applications.status` in the database by hand. Use the
   console; if the console cannot do it, the engine needs a new action.
3. Never put a secret in a `NEXT_PUBLIC_` variable.
4. Never edit a migration file that has been applied.
5. Never edit `admission_decisions`: it is append-only and the database
   refuses. Record a new decision with a reason instead.
6. Never activate a ruleset without the school's written thresholds. Until
   one is active, every assessed applicant is reviewed by a person, which is
   the safe default.
7. Never grant `assessments.author` to somebody who does not write
   questions: it is the only permission that can read answer keys.
5. Never switch `EMAIL_PROVIDER` to `resend` before the domain records are in
   place.
