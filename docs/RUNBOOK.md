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

## A parent says they paid but the site says "confirming"

1. Online payments are confirmed by asking the payment provider, not by the
   parent's browser. The site asks when they return, and again every few
   minutes from the cron. Applicant → **Payment** tab, or `/staff/payments`
   → **Being confirmed** → **Check with gateway**.
2. If the provider says it is not paid and the parent has a card statement
   showing a charge, note the reference on the task and ask finance to check
   the provider's portal; never record it as paid on the parent's word.
3. If the cron is not running, nothing confirms until somebody presses the
   button. Check `/staff/admin/jobs`.

## A bank transfer has arrived

`/staff/payments` → the family's row → **Record bank transfer** with the
amount, the date it reached the account and the bank's reference. That
receipt is what moves the application to paid and sends the parent a
receipt and the registration link. Half the amount records as a part
payment and opens a task for the balance.

## A document will not upload

1. Only PDF, JPEG and PNG are accepted, decided by the file's contents, and
   up to 10 MB. A Word file, a HEIC photo straight from an iPhone, or a
   renamed file is refused with a message saying which.
2. Ask the parent to take a fresh photo with the camera set to "most
   compatible" (JPEG), or to print to PDF.
3. Staff cannot upload on a parent's behalf in this phase; email the file to
   admissions and note it on the applicant until the parent uploads it.

## Enrolment will not confirm

**Confirm enrolment** is refused until every required document is uploaded
and accepted, and every required agreement signed. The registration page
lists what is missing. Accept or reject each pending document first; a
rejection emails the parent with your reason and asks for it again.

## Setting up WhatsApp

1. The school needs a WhatsApp Business Account and a verified number in
   Meta Business Manager. The engineer sets `MESSAGING_PROVIDER=meta` and the
   credentials, and registers `<site>/api/webhooks/whatsapp` in Meta.
2. Every message is a **template** Meta has approved: submit the wording for
   each moment (booking confirmed, reminder, offer, fees due…) in Meta
   Business Manager. **Set up → WhatsApp templates** lists the moments, shows
   the suggested wording, and says which variables fill which placeholder.
3. When Meta approves a template, enter its name on that row and tick
   **Active**. Then switch **Workflow settings → whatsapp_enabled** on.
4. Parents only get messages if they ticked the box on the enquiry form, the
   registration, or their application page. Replying STOP turns it off;
   START turns it back on. Staff can turn it on for a parent who asked by
   phone, from the applicant page — that is audited.

## A parent replied on WhatsApp

Replies land as a task (**WhatsApp replies** on the dashboard) with the text
quoted, on the applicant's WhatsApp tab. Answer by phone or email: the
system can only send approved templates, so there is no reply box, by
design.

## The document reading says something differs

1. When extraction is on, an uploaded birth certificate or report is read
   and compared with the form. A difference shows on the registration page
   (**Read from document**) and on the parent's form, and opens a task.
   **Nothing has been changed**: the reading is a proposal.
2. Open the document, decide which side is right. If the document is right,
   press **Ask the parent to check** — they get an email naming the detail
   and correct the form themselves. If the form is right, close the task;
   the flag clears when the parent next saves that section.
3. A reading that looks nothing like the document (a blurry photo, a
   different document uploaded under the wrong heading) is normal: reject
   the document with a reason and the parent uploads again.

## A waitlisted family, and a place has opened

When an offer is declined or expires, or a capacity is raised, the drain
notices within minutes and opens **Waitlist place available** for the
longest-waiting family. Record a decision of **Approved** on their applicant
page to draft the offer, or leave them waitlisted. With **Workflow settings →
waitlist_auto_promote** on, the promotion is automatic and the offer still
waits for a person to approve it.

## The morning digest did not arrive

1. **Workflow settings → digest_enabled** must be on; it is sent after
   `digest_hour` (Gaborone time), once per campus per day, only when there
   is something to report.
2. Each person has **Receives the morning digest** on Staff & roles; a
   campus-limited person gets their campuses', head office gets all.
3. `/staff/admin/dev-outbox` lists digests like any other email; a
   `failed` one shows why.

## Data retention: what will be removed

**Set up → Data retention** previews exactly which applications the next run
would anonymise (enquiries that went nowhere after 180 days, closed
applications after a year — both under Workflow settings) and lets you put
one on **Hold** with a reason. Anonymising removes the family's names,
contact details, documents, messages and notes for good; the application's
status, dates, campus and grade stay so the reports still count it. Nothing
runs until **retention_enabled** is on; **Run now** runs it today under
your name.

## Exporting students to Ed-admin

**Enrolment → Student export**: choose the campus and intake, download CSV
or JSON. Each download is a batch; the records are marked exported so the
default view shows only what is new, and a batch can be downloaded again
from the list. The columns are under **Set up → Export columns**; medical
fields are off unless an administrator turns one on, and that is deliberate.

## A parent cannot change their booking online

Inside the cutoff (**Workflow settings → reschedule_cutoff_hours**, 24 by
default) the booking page asks them to call. Staff can still move or cancel
it from the applicant page.

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
8. Never set `PAYMENT_PROVIDER=dev` on production. The adapter refuses to
   load there; if it somehow did, nothing would be charged and nothing
   could be marked paid, but parents would see a page that says so.
9. Never mark a payment as received without a bank reference you can point
   to on a statement. The recording is audited under your name.
10. Never switch `EMAIL_PROVIDER` to `resend` before the domain records are in
    place.
11. Never send a parent a WhatsApp message they did not opt in to, and never
    add a way to send free text: Meta will suspend the number, and the
    wording would live outside the templates the school controls.
12. Never copy a document reading into a registration by hand. The parent
    confirms or corrects; that is the record.
13. Never turn a medical export column on without the data-protection
    officer's say-so, and never switch `retention_enabled` on without reading
    the preview first. Anonymisation cannot be undone.
