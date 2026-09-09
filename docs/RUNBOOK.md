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

## Where the assessor gets the code

The code is made when the assessment is launched, and nowhere else. On the
day: **Dashboard → Open check-in board** (`/staff/assessments/today`), find
the child, press **Check in**, then **Launch**. The dialog shows a six-letter
code, a QR code and the address of the assessment page (`/sit`). On the
assessment computer, open that page and type the code. The code is shown
once and is not stored; while the sitting says "Waiting for code", press
**New code** on the board or on the attempt page to issue another. Once the
child has started there is no code to show: the sitting is already open on
that computer. This needs the `assessments.deliver` permission.

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

## Running a story sitting (Reception to Stage 3)

The youngest applicants do not sit a paper. Their template is a **story**
(Tumi's Journey, one chapter per stage) and an adult sits beside the child.

1. Launch from the check-in board exactly as for a paper; the code opens
   `/sit` on the assessment computer, which needs **speakers** (not
   headphones: the adult listens too) and a mouse or touch screen.
2. Press **Start the story** when you are both ready. The sound can only
   start after that tap. Tumi speaks every line; the loudspeaker button on
   the bubble says it again. With `ELEVENLABS_API_KEY` set, the lines are
   real recordings (a soft British voice, "Lily", unless
   `ELEVENLABS_VOICE_ID` says otherwise), each made once and kept; press
   **Record the voice** on the template page before the first sitting of a
   chapter so nobody waits for the first recording. Without the key, the cog
   on the dark strip chooses a browser voice: a soft female English voice is
   picked automatically, and on Windows the Edge browser's "Online
   (Natural)" voices sound best.
3. The dark strip at the bottom is yours, not the child's. It says what to
   look for; press **Yes**, **Partly** or **Not yet** for what the child did,
   or **Skip** to move on without a mark. When the child answers on screen
   (tap, number pad, ordering), press **Next**.
4. A strand stops on its own after three "Not yet" in a row: the remaining
   items of that strand are skipped and saved as skipped. That is by design,
   so a child is never pushed through things that are too hard.
5. **Pause** stops the voice and hides the scene. **Finish and hand in** on
   the last screen ends the sitting; marking and the learning profile follow
   as for a paper.
6. To rehearse without a child, open `/sit/preview?c=reception` (also
   `stage1`, `stage2`, `stage3`) while signed in to the staff console; on
   a preview deployment it needs no sign-in. Nothing is saved.

To change a chapter, edit `web/content/story/<chapter>.json`, run
`node web/scripts/story-seed.mjs > seed.sql` and apply it: the seed upserts
by item code and touches no sitting already taken. Scene pictures are
chosen by the item's focus tokens (`apples:3`, `cards:1,3,5`, `clock:4:30`,
`text:…`, `fractions:1/2,1/4`, `chart:rain`, a trailing `!` to highlight);
a token nobody has drawn shows as a labelled card.

## The Cambridge papers (entry to Stage 4, 5, 6 and 7)

Applicants for Stage 4 and above sit a 40-minute paper on screen, drawn
from the school's licensed Cambridge Primary Progression Tests. Which
paper a child gets follows the stage they are entering:

| Entering | Paper |
|---|---|
| Stage 4 | Cambridge Stage 4 |
| Stage 5 | Cambridge Stage 5 |
| Stage 6 and Stage 7 | Cambridge Stage 6 |

1. The sitting has three parts with their own clocks: English 15 minutes,
   Mathematics 13, Science 12. A part closes when its clock runs out and
   the child moves on; the 40-minute clock covers the whole sitting.
2. Each part is a **selection** from the full paper, chosen to fit the
   time and spread across the paper's strands and difficulties. The whole
   paper is in the question bank: to change what is asked, open
   **Settings → Assessment templates → Cambridge Progression · entry to …**
   and edit the part's question list.
3. The long writing task is replaced by a **short piece** (one paragraph,
   about five minutes, marked out of 8). Both it and the full 25-mark task
   are in the bank with their own marking grids.
4. Questions that need drawing, shading or measuring on paper are left
   out; each paper's JSON file lists them under `omitted` with the reason.
5. Marking is automatic for everything except the writing and the
   open-ended "any valid reason" answers, which wait for a person on
   **Assessments → Marking**. A question whose note says a person should
   check it is one of those.

To change the content, edit `web/content/papers/<stage>-<subject>.json`,
run `node web/scripts/paper-seed.mjs > seed.sql` and apply it. The seed
upserts by question code and never touches a paper already sat. The
Cambridge material is the school's licensed copy: the pictures are served
only to a computer with an open sitting or a signed-in staff member, and
never sit on a public address.

## A child ran out of time

The sitting is submitted automatically at the time limit (plus a short
grace period) and marked as **auto-submitted** on the attempt page. Unanswered
questions score zero. If a child needs more time for a known reason, set the
**time multiplier** in the Launch dialog *before* they start; it is recorded
on the attempt so the assessor can see it.

## A written answer was marked wrongly, or is still waiting

Written answers are marked by the AI on submission when `ai_auto_mark_enabled`
is on and the site runs with a real AI provider. On the attempt page each
such answer shows "AI mark", the band and the reason. To change one, pick the
band or type the marks and save: your mark replaces the AI's and the scores
recompute. If answers are still "waiting for a person", either the switch is
off, the site is running the development AI adapter (`AI_PROVIDER` unset),
the question has no rubric, or the model could not mark it; in every case the
usual marking task is opened and a person marks as before.

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

## Putting conditions on an offer

On the Offers page (or the applicant's Offer tab) an offer waiting for
approval has **Add conditions to this offer**. Tick the ones that apply:
a learning facilitator, a place in a lower stage (choose the stage: the
application, the fees and the letter move to it), extra tutoring, an
occupational therapist's, educational psychologist's or speech therapist's
report, English language support, a probationary first term, the previous
school's report and transfer certificate, or a meeting with the head. Add
anything else in a sentence the parent will read. **Apply conditions and
re-draft** rewrites the letter, which still waits for approval; the
conditions appear as numbered sentences under "This offer is made on the
following conditions". The wording of the standard conditions lives in
`web/lib/offers/conditions.ts`; a letter already sent keeps its text.

## An offer cannot be approved

- **"Waiting for profile"**: see above. The results email links the profile,
  so an offer is never sent without one.
- **"No active fee schedule"**: `/staff/admin/fees` needs an active schedule
  for that campus, academic year and grade. Activate one, then press
  **Generate offer** on the applicant. Finance owns the amounts.
- **No active offer template**: `/staff/admin/offer-templates` — publish a
  version.

## Running a promotion

Settings → **Promotions**. Name the deal, tick the fees it waives, set a
discount on the admission fee if any, list the gifts one per line as the
parent should read them, and switch it on. Give it a **code** if it is
advertised (the enquiry form asks for a code only while a coded deal is
live); leave the code blank and set the rules instead if it should apply to
everyone who qualifies, for example every Block 7 enquiry in October.
The deal appears on the offer when it is drafted, on the Offers page for
the approver to see, and on the letter. To give a deal to one family who did
not type the code, use **Apply** in the Promotion box on the Offers page
with a reason; **Remove** takes it off. Both re-draft the offer, which still
waits for approval. A deal that waives everything sends the parent straight
to registration with the "fees waived" email; no payment record is invented.
Switch a deal off rather than deleting it once it has been used.

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

## What a parent hears after pressing Submit on registration

The moment the form is submitted, the "registration received" email goes
out. If a section is unfinished or a document is missing, it names them
and links back to the form; if everything is in, it says the office will
check the documents and confirm enrolment. When something was outstanding,
a reminder follows after **documents_reminder_days** (Workflow settings,
2 by default) and skips itself if registration is complete by then. The
reminders at 7 and 14 days after payment continue as before.

## A document will not upload

1. Choosing the file is the upload: there is no second button. The phone
   sends the file straight to the school's private storage (a big photo is
   shrunk to about 2,000 px first), then the server checks it and records
   it. "Uploaded" with a green tick means it is there; the Documents page
   shows it as "received".
2. Only PDF, JPEG and PNG are accepted, decided by the file's contents, and
   up to 10 MB. A Word file or a renamed file is refused with a message
   saying which. An iPhone HEIC photo is converted to JPEG on the phone when
   the browser can read it; if not, ask for the camera set to "most
   compatible" (JPEG), or a print to PDF.
3. If the parent's browser has JavaScript off, a plain form still works,
   one file at a time, up to the hosting limit of about 4 MB.
4. Staff cannot upload on a parent's behalf in this phase; email the file to
   admissions and note it on the applicant until the parent uploads it.

## "Upload the birth certificate and we fill it in"

With `DOCUMENT_EXTRACTOR=anthropic` set on the hosting and
**ai_extraction_enabled** on under Workflow settings, the student step
offers the birth certificate upload first. The reading fills only what the
family has not told us: middle names, place of birth, gender and the
registration number. The names and date of birth from the enquiry are never
changed by a document; a disagreement is shown as a flag for the parent to
resolve and a task for staff. Every filled field is marked "read from the
birth certificate — please check", and the parent's save is what writes it.
If the reading fails or takes longer than a minute, the form simply stays
as it was.

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

## Changing a session (time, place, assessor, places)

**Settings → Sessions**. The page opens on today and groups by day. Narrow it
with the filters at the top: campus, kind, from a date, or only the sessions
somebody has booked. Press **Edit** under any session to change its date,
time, length, number of places, grade range, assessor or room. The capacity
cannot be set below the number already booked; move those families first.

Delete only works while nobody is booked. When somebody is, **Unpublish** it
instead: it disappears from the parents' list and the people already booked
keep their place.

## Closing the school for a day, or changing the daily times

Sittings and visits appear on every weekday at every campus by themselves,
six weeks ahead. To keep a day free, add it under **Set up → School
holidays** before the day is created; deleting a session by hand only frees
the day until the next run adds one back. To change the times, places or
how far ahead they run, edit the `auto_sessions_*` rows under **Workflow
settings**; existing days keep their old times, new days take the new ones.
To stop the schedule altogether, set `auto_sessions_enabled` to false.

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

## Updating a policy document

The four agreements a parent signs at registration (Learner Code of
Conduct, Parent Policy, Fees Policy, Parent Acknowledgement and Agreement)
carry the full text of the January 2026 documents and link to the PDFs,
which this site serves from `web/public/policies/2026/`. When the school
publishes a new edition:

1. Under **Set up → Agreements**, open the agreement and paste the new
   wording into the body. That publishes a new version; families who
   already signed keep the version they saw, with its hash.
2. Put the new PDF in `web/public/policies/<year>/` and point the link at
   it (a path such as `/policies/2027/Fees-Policy.pdf`), or point the link
   at the PDF on the school website (`https://…`). Either is accepted.
3. Retire an agreement there when it no longer applies; add one with a new
   key when a new document must be signed.

The reading order is fixed by the database (`sort_order`): the
acknowledgement that refers to the other three comes last.

## A parent asks what they signed

The registration page in the console lists each agreement with the version
signed, the printed name, the date, and the drawn signature. An acceptance
made before signatures were drawn shows "typed name only". The body the
parent saw is the version named there, under **Set up → Agreements**
(retired versions stay in the database). **Signed agreements (PDF)** on
that page, or the applicant's **Downloads** tab, produces one file with
every policy in the wording accepted, the signature as drawn and the
fingerprint that ties the text to the stored copy: what to send to a
parent or a lawyer who asks.

## Getting a document as a PDF

Applicant page → **Downloads**: the offer letter, the payment receipt, the
learning profile, the assessment report, the registration record
(everything the family gave, including medical details, the documents
received and the agreements signed) and the signed agreements. "Open" shows
it in the browser; "Download" saves it. A document that does not exist yet
says why. Every download is written to the audit log with who and when.
The parent's own uploads (birth certificate and so on) are viewed from the
registration page.

## Exporting students to Ed-admin

**Enrolment → Student export**: choose the campus and intake, then take
**two** files in the school system's own layout.

1. **Parent details (CSV)** — 96 columns, the guardians and their contact
   details. Take this one first. It changes nothing, so it can be taken as
   often as you like.
2. **Student details (CSV)** — 33 columns, the children. This is the one that
   records the transfer: it creates the batch and marks those records as
   sent, so the default view then shows only what is new.

They are separate files on purpose — that system will not take parent and
student details together. The **only** thing in both is the **family code**,
which is what tells it that these parents and these children are one family.
Import the parent file first, then the student file; the codes in the second
attach each child to the account the first one opened.

A past batch can be taken again as either half, from the list at the bottom.
The pair always matches, because both are rendered from the same records.

Columns we do not collect (employer, passport number, debit order, religion,
class) are present and empty, because a row has to be the same shape as the
header. Dates are written `dd/mm/yyyy`.

The older, configurable layout is still there under *Or the older,
configurable layout*, with its columns under **Set up → Export columns**;
medical fields are off unless an administrator turns one on, deliberately.

## Family codes, and two parents who enquired separately

A family gets a code the first time it appears — three letters of the surname
and a number: `COE1`, and `COE2` for an unrelated second Coetzer family. It is
given once and **never changes**, which is the whole point: the second child
carries the same code as the first, so the school's other system puts them on
one account and sends one statement.

If a mother enquires for one child and a father enquires for another, they are
two contacts with two codes, and the school would get two accounts. That is
the one case where a code is changed, and it takes a deliberate step:

```sql
select merge_family_code('<the second contact id>', '<the code to join>');
```

Ask for this to be run; it refuses a code no family holds, and it is the only
route past the rule that a code never changes. **Anything already exported
keeps the code it went out with**, so tell the other system about the merge
too — otherwise the older half stays on its own account there.

## A parent cannot change their booking online

Inside the cutoff (**Workflow settings → reschedule_cutoff_hours**, 24 by
default) the booking page asks them to call. Staff can still move or cancel
it from the applicant page.

## The dashboard counts look wrong

They are computed live from the same rows the pipeline shows; if the pipeline
is right, the counts are right. Campus-restricted staff see only their
campuses in both.

## A family walks in without a booking

On the applicant's page, under Assessment, press **Start now (walk-in)**. It
opens a session for right now at their campus (one place, unpublished, so
nobody else can book into it), books the child, checks them in, launches the
sitting and shows the code. If the child already has a booking for today it
uses that one rather than making a second.

The applicant has to exist first. For a family with nothing on the system,
press **Add applicant** on Applicants (see below), then start the walk-in
from their applicant page.

## Adding an applicant by hand

**Applicants → Add applicant.** For a family at the desk or on the telephone.
Fill in the child, the parent, the campus and the start term; leave **Grade**
on "Work it out from the date of birth" unless the family is transferring
into a particular year, in which case choose it — the campus must teach it.

What it makes is an ordinary application: the same reference, the same first
emails to the parent, the same link for them to carry on at home. Two things
differ. It is recorded as a walk-in rather than a website enquiry, so the
analytics can tell the two apart, and the audit trail names the member of
staff who added it.

Read the email address back to the parent before pressing the button —
everything the school sends goes there, and a wrong letter means silence.

If the family already has an application, this opens the one they have rather
than making a second.

Tick the WhatsApp line only when the parent has actually said yes; it is
consent, and it is recorded as having come from staff.

## Setting up a school's admissions team

`/staff/admin/staff`. Invite each person with the **Campus administrator**
role and tick their campus under **Limit to campuses**; a campus
administrator with no campus ticked sees nothing at all, and the form refuses
to save that. The person who approves offers and decides reviews for that
school gets **Admissions manager** with the same campus limit. Head-office
staff have no campus limit and see every school. Every list, count and
report in the console follows the same rule automatically.

Until the person has used their invitation their card shows **Invitation not
yet accepted** with a **Resend invitation** button; press it to send a fresh
link. Once they have set a password the button goes away, and a forgotten
password is reset from the sign-in page instead.

### Who may do what to the staff list

Three separate powers, so that running admissions does not quietly mean
running the whole system:

| | Admissions manager | Super administrator |
|---|---|---|
| Invite a colleague, set their roles and campuses, turn a sign-in on or off | yes | yes |
| Change what each role may do (the matrix at the bottom of the page) | no — shown for reference | yes |
| Delete a person's account outright | no | yes |
| Change their **own** roles or campuses | no | yes |
| Give somebody a role carrying a permission they do not hold themselves | no | yes |

The last two matter more than they look. Someone who can edit the matrix can
give their own role every permission there is, and someone who can hand out
**Super administrator** can invite a second account for themselves and sign in
as it — either one turns "may manage staff" into "may do anything". The
database refuses both, not merely the screen, so it holds even if somebody
reaches past the console.

A role that is above your own ceiling appears greyed out with *above what you
hold*. Ask a super administrator to make that change.

## An invitation link says it has expired

It should not any more. Invitations are ours now, not Supabase's: the link in
the email does not expire, and it is spent only when the person actually sets
a password, so the scanners that school mail systems run over links cannot use
it up. If someone still cannot get in:

1. **They have already signed in once.** The link works once. Send them to the
   sign-in page and use **Forgot password** instead.
2. **A newer invitation was sent.** Sending a new one revokes the old, so an
   older email in the inbox stops working. Ask them to use the most recent.
3. **The account was deactivated.** Tick "Can sign in" on the staff page, save,
   then press **Resend invitation**.

To send a fresh one: **Settings → Staff**, find the person, **Resend
invitation**. Anyone who has never signed in can be sent one.

## Somebody left, or joined

`/staff/admin/staff`. Untick **Can sign in** to remove access at once —
their sessions end on the next request. Nothing they did is deleted; the audit
trail keeps their name.

**Delete** is a super administrator's button and does not appear for anyone
else. It removes a person entirely (sign-in, profile, roles, campuses) and
is for mistakes: a wrong email, a test account, an invitation never accepted.
Applications, tasks and sessions assigned to the person are unassigned. It
refuses anyone with history (a decision, an approval, a marked answer, a
recorded payment, a note…) and says what it found; deactivate those people
instead so the record of who did what stays intact. Deletions are audited.

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
