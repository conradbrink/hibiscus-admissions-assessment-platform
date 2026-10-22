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
2. `queued` for more than ten minutes: the job drain is not running. Open
   `/staff/admin/jobs` — the strip at the top says when the scheduled drain
   last ran. Press **Run pending now** to clear the backlog either way. If
   that strip is amber or red, see *The queue has stopped draining* below.
3. `failed`: open the message; the error is shown. A bad address is the
   parent's to fix; a provider error is ours.
4. `sent` but not received: ask them to check spam. If this is common, the
   sending domain's SPF/DKIM/DMARC records are wrong.
5. `bounced`: the address does not exist. Phone them.

## The queue has stopped draining

`/staff/admin/jobs` shows when the scheduled drain last ran and how many
scheduled runs arrived in the last 24 hours, against the 288 a five-minute
schedule asks for. Anything a parent or a member of staff does drains the
queue by itself, so the symptom is never a stuck enquiry — it is timed work
running late: a reminder, the weekday sittings, the nightly sweeps.

Three things call the drain, at three cadences:

| | Cadence | Where |
|---|---|---|
| Supabase `pg_cron` | every 5 minutes | the real schedule |
| GitHub Actions | hourly | `.github/workflows/drain.yml`, a backstop |
| Vercel cron | nightly 03:00 | `web/vercel.json`, a last resort |

If the strip is red, work down that list:

1. **Are the Vault secrets set?** `pg_cron` calls the site using
   `drain_url` and `drain_cron_secret` from the Supabase Vault (Project
   Settings → Vault). If either is missing the tick is a deliberate no-op
   and nothing is logged. `drain_cron_secret` must equal Vercel's
   `CRON_SECRET`; if that was ever rotated, rotate this with it.
2. **Is the job scheduled?** In the SQL editor:
   `select jobname, schedule, active from cron.job;`
3. **What did the calls come back with?**
   `select status_code, error_msg, created from net._http_response order by created desc limit 10;`
   A 401 means the two secrets have drifted apart.
4. **Run the backstop by hand** while you fix it: the *Drain job queue*
   workflow in GitHub Actions has a **Run workflow** button, and
   **Run pending now** on `/staff/admin/jobs` does the same from the console.

## Nobody can book

Parents can only book **published** sessions at **their** campus for **their**
grade with **places left**. `/staff/admin/sessions` shows all four. The most
common cause is that nothing has been published for next month yet.

## A no-show was marked by mistake

The parent has been emailed a rebooking link. The applicant page's **Next
step** now reads **Rebook assessment**: pick the same session there — the
no-show stays in the timeline as a record, which is correct.

## A child was checked in by mistake

A booking ends as attended or as missed, never both, so a checked-in child
cannot be marked a no-show (the database refuses it too). Press **Cancel
booking** on the applicant page's assessment card: the family goes back to
booking and is emailed a link to choose a time.

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

Four chapters of *Tumi's Journey*, one per stage. They were re-levelled in
September 2026 after the school found them too hard for the age they were set
at: every chapter now serves the stage above the one it was written for, and
Reception has a gentler chapter of its own.

| Stage | Chapter | Items |
|---|---|---|
| Reception | The garden | 28 |
| Stage 1 | The river | 45 |
| Stage 2 | The village | 43 |
| Stage 3 | The market | 40 |

*The hill* is retired and kept as a draft; it can be brought back from
Settings if a Stage 4 sitting is ever wanted.

The Reception chapter is deliberately shorter and gentler: 45 minutes rather
than 60, and it moves on after **two** misses in a strand rather than three,
because a four-year-old who cannot do something should not be asked a third
time.

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
4. A strand stops on its own after three "Not yet" in a row — two, in the
   Reception chapter: the remaining items of that strand are skipped and saved
   as skipped. That is by design, so a child is never pushed through things
   that are too hard.
5. **Pause** stops the voice and hides the scene. **Finish and hand in** on
   the last screen ends the sitting; marking and the learning profile follow
   as for a paper.
6. To rehearse without a child, open `/sit/preview?c=garden` (also `river`,
   `village`, `market`, and `hill` for the retired one) while signed in to the
   staff console; on a preview deployment it needs no sign-in. Nothing is
   saved. The chapters are named for their story, not their stage, because
   they have moved stage once already.

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

## Fees for a campus that charges by the month

Most campuses quote a term. Potchefstroom and Bana Tlokweng quote a month.
Tlokweng's schedules carry one `Tuition per month` line. Potch's carry two
rates — `Tuition per month (half day)` and `(full day)` — and, for Grade RR
and Grade R, a `Lunch per month` line; Babies to Juniors have lunch in the
price. The offer letter prints whichever lines the schedule has, and once
**Full or half day?** is set on the applicant it prints the one rate the
child is on.

**Settings → Fees**, choose the campus and year. A monthly line is invoiced,
never payable on acceptance; only the administration, application and
admission lines secure a place. There is no annual line to keep in step: the
letter quotes the month, and the family's year is however many months they
attend.

Potch is priced in Rand while every other campus is in Pula. That is per
schedule and correct; be aware the card gateway has not been tested with ZAR.

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

## Selling tickets for an event (the Christmas Show)

1. CRM → **Events** → the event → **Tickets and stalls**. A ticketed event
   needs a campus; the campus decides the currency.
2. Set the **start time** on the event itself (**Edit**), then tick **Show
   the start time on the public page** on the tickets page. Until then the
   page prints the date only.
3. Check the prices, the early bird's last day, and the stall price and how
   many tickets come with a stall. A price change applies to new orders
   only. Tick **Tickets on sale** and **Stall bookings open**, and **Save**.
4. Share the two links under **Links to share**. Buy one ticket yourself
   first and check the email arrives.

Every person needs their own ticket with their own name. A parent buying
for four types four names.

## At the gate

On a phone or laptop signed in to the console, open the event's **Tickets
and stalls** page. Type the number printed on the ticket (any case, with or
without spaces), or scan the QR code with the phone's camera and paste the
number, and press **Check in**.

- **Let in: name**: the ticket is good. Check the name with the person.
- **Already used**: the number came in before, at the time shown. Ask for
  the name; it may be a copied ticket.
- **Not a ticket for this event**: do not let them in on that number.

A mistake is undone with **Undo** beside the ticket in the orders list.
People who pay at the gate are the school's cash process; they are not
recorded here.

## A buyer says their tickets never arrived

Tickets page → the order → **Email the tickets again**. It goes to the
address they typed, with a new link. If the address was wrong, read them
the numbers from the order instead; the gate needs only the number and the
name. If the order says **Paying** for more than a few minutes, see the
section below on "confirming": the same check applies.

## A buyer wants a refund

Finance refunds it at the gateway, as for any card payment. The order
stays paid here and its tickets stay valid, so if it matters, tell the gate
the numbers (they are on the order).

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

## Everything is filled in but the registration still says "incomplete"

The status moves on the parent's **Submit** and on nothing else. A parent who
pressed Submit with a document missing and uploaded it later, or whose last
document the office uploaded for them, is left with every section done and
the status still **Registration incomplete**. They are listed first on
**Admissions → Enrolment → Registrations**, under **Filled in, not yet
submitted**, and the applicant page's Next step reads **Confirm registration**.

Press **Confirm registration** (on the queue, on the registration page, or on
the applicant). It does what the parent's Submit would have done: the status
moves to Registration complete, the parent is emailed that everything has
been received, and a **Confirm enrolment** task opens. It is refused, with
what is missing, unless the same rule the parent's Submit uses says the
registration is complete — enrolment would refuse it a step later anyway.

## Two parents or guardians on every registration

From 15 October 2026 the Family step asks for **two** parents or guardians,
and an email and a mobile number for each. There is no exception for a family
with one parent: they give another person who looks after the child, such as
a grandparent. The school's other system, Ed-admin, gets this person on its
G2 tabs. Nothing checks that the second guardian is somebody else: a father
and the grandfather he names can share a name, and couples share a mobile and
an email, so any such check would stop real families registering. The
registration page shows both guardians, so the office can spot a parent
entered twice and ask for another person.

The rule is checked when the parent saves the Family step. A family that
saved it before then with one guardian is not sent back: their registration
stays complete, and their G2 tabs are empty in the Ed-admin file. The office
cannot enter a guardian for a family. While the registration is still open,
the parent can add one by opening their link and saving the Family step
again.

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

The school sends through **Zavu**. Two other ways in are built and kept —
**Meta's own Cloud API** and **Twilio** — and which one is live is the
`MESSAGING_PROVIDER` setting, so moving between them is configuration rather
than a deployment. Whichever it is, the wording is a template WhatsApp has
approved: free text is never sent, because WhatsApp only allows it inside a
24-hour reply window and it would put the school's words in code.

**Through Zavu** (`MESSAGING_PROVIDER=zavu`)

1. In the Zavu dashboard: connect the WhatsApp account, then mint an API key
   under **API keys**. A key beginning `zv_test_` sends against Zavu's
   WhatsApp sandbox instead of a real number — start there. `zv_live_`
   reaches real people. The engineer sets it as `ZAVU_API_KEY`.
2. Create a template per moment in Zavu and let it submit each for WhatsApp's
   approval. The wording, the variables and the button of every one of them
   are in `web/content/messaging/zavu-templates.json`; print them as the
   dashboard's own fields with

       node web/scripts/zavu-templates.mjs            # all of them
       node web/scripts/zavu-templates.mjs --only offer_reminder

   Variables are numbered, so the order of the variables listed on the row in
   **Set up → WhatsApp templates** is the order they fill the wording; a
   message with a link fills the button's own first variable, numbered
   separately from the body's.

   The button is a **URL** button, not a Quick Reply, its **URL type** is
   **Dynamic**, and Meta accepts a pattern containing `{{1}}` only when an
   example is submitted beside it. Without the example the submission comes
   back *"components[1]['buttons'][0]['url'] is not a valid URI"* — braces are
   not legal in a URI, and Meta has not been told to expect them. **Example
   value** takes what fills `{{1}}` — the token on its own, not the whole
   address, which the dashboard appends to the pattern: paste an address there
   and the preview reads `…/a/https://…/a/…`.

   Meta also refuses wording that ends on a variable, full stop or not, so
   every template closes on words.
3. When a template is approved, copy its **id** onto the row in **Set up →
   WhatsApp templates** and tick **Active**. To do a batch at the console
   instead:

       node web/scripts/zavu-templates.mjs --sql booking_confirmed=<id> offer_reminder=<id>
4. Point the sender's webhook at `<site>/api/webhooks/whatsapp`. Zavu shows
   the signing secret **once**, when it registers the webhook — put it in as
   `ZAVU_WEBHOOK_SECRET` there and then. Without it every delivery is refused,
   which is the safe direction but means no reply ever arrives.
5. If the account has more than one sender, set `ZAVU_SENDER_ID` to the one
   the school sends as. It is the sender profile's own id — the last part of
   the dashboard address when the profile is open. With a single sender,
   leave it unset and Zavu picks the only one.

**SMS through Zavu**

A campaign may also go by SMS: one way, as the school's name, from the Zavu
sender whose **SMS One Way** channel is switched on (the "HIBISCUS" sender).
An SMS needs no approval from Meta; its words are the campaign's own, with
the same `{{variables}}` as the email, and a marketing SMS goes only to a
contact with SMS consent.

1. In Zavu, open the sender that texts as the school and copy its id, the
   last part of the address (`/sender-profiles/<id>`).
2. In **Workflow settings**, set `sms_sender_id` to that id. Left empty, SMS
   goes out as the messaging sender (`ZAVU_SENDER_ID`), which may be the
   WhatsApp one and have no SMS channel.
3. Set `sms_enabled` to `true`. While it is `false`, every SMS a campaign
   would send is skipped with the reason "SMS is switched off".

A parent cannot reply to a one-way SMS, so it never appears in the WhatsApp
inbox; it is on the family's timeline, and its delivery comes back through
the same webhook as WhatsApp's.

**Through Twilio** (`MESSAGING_PROVIDER=twilio`)

1. In the Twilio console: a WhatsApp sender (the school's number, through
   Twilio's WhatsApp onboarding), then the account SID and auth token from the
   dashboard. The engineer puts those in as `TWILIO_ACCOUNT_SID` and
   `TWILIO_AUTH_TOKEN`, with `TWILIO_WHATSAPP_FROM` set to the sending number
   in full international form.
2. Each message is a **Content Template** in Twilio, which submits it to
   WhatsApp for approval. Its variables are numbered `{{1}}`, `{{2}}` in one
   flat list; where a message carries a link, the token is the variable
   **after** the body's, because Twilio has no separate button component.
3. When it is approved, copy its **content SID** (`HX…`) onto the row in
   **Set up → WhatsApp templates** and tick **Active**.
4. Point Twilio at `<site>/api/webhooks/whatsapp` twice: as the sender's
   inbound webhook, and as `TWILIO_STATUS_CALLBACK_URL` so delivery is
   reported. One route serves both.

**Through Meta** (`MESSAGING_PROVIDER=meta`)

1. The school needs a WhatsApp Business Account and a verified number in Meta
   Business Manager. The engineer sets the credentials and registers
   `<site>/api/webhooks/whatsapp` in Meta.
2. Templates are submitted and approved in Meta Business Manager. When one is
   approved, enter its **name** on the row and tick **Active**.

**Either way**

* **Set up → WhatsApp templates** lists every moment, shows the suggested
  wording, and says which variables fill which placeholder. A row can carry
  both identifiers at once, which is what makes moving between providers a
  settings change rather than a deployment.
* Switch **Workflow settings → whatsapp_enabled** on last.
* Parents only get messages if they ticked the box on the enquiry form, the
  registration, or their application page. Replying STOP turns it off; START
  turns it back on. Staff can turn it on for a parent who asked by phone,
  from the applicant page — that is audited.

## Every WhatsApp message says "no template id set"

The row is active but has nothing in the column the live provider reads:
Twilio needs the content SID, Meta the template name. Open **Set up →
WhatsApp templates**, and the row will show a dash against whichever is
missing. Nothing was sent and nothing was lost — each attempt is recorded as
skipped with that reason, and the moment will send once the id is in.

## Zavu rejects every webhook

The reason is logged each time, and there are only three. **"no webhook
secret configured"**: `ZAVU_WEBHOOK_SECRET` is unset — Zavu reveals it only
when it first registers a sender's webhook, so re-register the webhook to
mint a new one. **"signature mismatch"**: the secret belongs to a different
sender. **"delivery is …s old"**: the delivery is more than five minutes old,
which is a replay or a clock that has drifted — check the server's time
before anything else.

## Twilio rejects every webhook as unsigned

Twilio signs the **URL it called** together with every form field, so the
address the app sees has to match Twilio's exactly. Behind a proxy that
terminates TLS the app can see `http` where Twilio used `https`, and then
every signature fails and every reply is answered 401. Set
`TWILIO_WEBHOOK_URL` to the exact address configured in the Twilio console.

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
six weeks ahead, one of each at each of the school's sitting times (08:00,
09:30 and 11:00). To keep a day free, add it under **Set up → School
holidays** before the day is created; deleting a session by hand only frees
that slot until the next run adds one back. To change the times, places or
how far ahead they run, edit the `auto_sessions_*` rows under **Workflow
settings** — `auto_assessment_starts` and `auto_visit_starts` are lists of
clock readings in minutes after midnight, school time, so `[480, 570, 660]`
is 08:00, 09:30 and 11:00. Existing days keep their old times, new days take
the new ones; adding a time fills it in on days that already exist too.
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
4. **"Check the name on the birth certificate by eye"** (or the report,
   or the vaccination card). Names are compared in the Latin alphabet.
   When a name on either side has letters of another script (a
   certificate in Chinese, Arabic or Cyrillic, a name printed in two
   scripts, or a name typed that way on the form), the machine cannot tell
   whether they match. The name shows **check by eye** on the registration
   page and this task opens. Nothing shows on the parent's form and the
   parent is not emailed. Look at the document: if it is the right child,
   accept it; if not, reject it with a reason and the parent is asked to
   upload it again. Either closes the task, and the badge then reads
   **checked by eye**. So does a replacement document whose name the
   machine can compare. A reading of a document that is already accepted
   or rejected opens no such task. Each kind of document has its own
   tasks, so dealing with the birth certificate never closes the school
   report's.
5. A reading can both differ on another detail (a date of birth) and have a
   name to check by eye. Then both tasks open: the difference is flagged
   to the parent as in step 2, the name is not.

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

## Deleting an applicant for good

Almost never the right answer, and behind a permission only the super
administrator has. Reach for one of the other two first:

* a family who is no longer applying → **Withdraw**, under **More actions**
  at the bottom of the applicant page.
  The record stays, the pipeline stops, the reports still count the enquiry.
* a family asking to be forgotten → **Set up → Data retention**. Anonymising
  removes the person and keeps the shape of the funnel honest.

Deleting is for a record that should never have existed: a parent who sent
the form twice, a training entry, a walk-in typed against the wrong family.
It is under **More actions** at the bottom of the applicant page, it asks for a reason and for the
reference typed out in full, and it removes the child, the family, their
documents, assessments, offers and payments. The files go from storage
first, then the database rows.

It cannot be undone. What survives is one line in the audit trail saying
what the reference was, whose child it was, and why you deleted it — so
**Set up → Audit trail** still answers "where did HBS-2026-00019 go?".

If two children of one family are applying, deleting one leaves the parent
and the other child alone. The parent's record only goes when their last
application does.

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

## Which families are behind a number on Insights

Every figure on **Insights** that counts families opens the list of exactly
those families: the headline figures (Enquiries, Enrolled, and the rates,
which open the families they count as having made it — No-show rate opens
the no-shows), each bar of the **Admissions funnel** (Approved 20 opens those
20), the "N deferred" note under it, each row of **Where families heard about
us**, **By campus** and **By grade**, and every number in the **Breakdown**
table (Pre-Kindergarten × Offered opens the Pre-Kindergarten families sent an
offer). **Where are we losing applicants?** opens the families each step has
not converted, as before.

The list says what it holds ("Offer sent, from families who enquired 14 Sept
to 14 Oct 2026 at Bana Tlokweng") and holds the same families the figure
counted: same period, same campus, same rule. Each family appears with where
they are **now**, which is often further on than the figure, because the
figure is "reached this stage" and the family kept going. **Back to
analytics** returns to the same period. A zero is not a link.

The list shows **Last contacted** for each family: when the school and the
family last spoke. It is the same date as **Last contact** in the CRM, and
moves with every email and WhatsApp message either way (the automatic ones
too) and whenever somebody presses **Log contact** on the family's CRM page
after a call or a conversation at the desk. A fortnight or more, or never,
is marked in amber. If a family was phoned and nobody logged it, this date
does not know: log the call.

## Downloading an applicant list (Excel or PDF)

Every applicant list has **Excel** and **PDF** beside its description: a
stage, a status, a search, or a list opened from Insights. The file holds the
whole list, not just the page of fifty on screen, with the same columns
(including last contacted) and a line saying what it is a list of. The Excel
file has a second sheet, **About this list**, with the same and who took it.
The Excel file takes up to 5,000 applicants and the PDF up to 1,000 (about
80 printed pages); past that the file says how many were left out, so narrow
the list or take the Excel file. A list opened from Insights over a long
period may also say that only the period's first enquiries could be read:
Insights itself counted only those, so choose a shorter period.

Who may download is ticked per role: **Settings → Staff and roles → What each
role may do → applications.export** ("Download applicant lists as Excel or
PDF"), then **Save** under that role. **Management** and the **Admissions
manager** have it from the start. It only works for a role that can also see
applicants (`applications.read`). A person sees only the campuses they may
see, in the file as on screen. Every download is written to the audit log
(`applications.exported`) with the filters, the count and who took it; if
that record cannot be written, the download is refused rather than made
unrecorded.

## Downloading any page as a PDF

Every staff page, in admissions and in the CRM, has a **Download PDF**
button (the page-with-an-arrow icon) in the strip at the top, beside the
tasks icon. It opens the browser's print window: choose **Save as PDF** as
the printer. The PDF is the page as it is on screen, with its filters and
open sections, without the menu, the top strip or the sticky bar at the
bottom of an applicant's page. A folded section prints folded, so open it
first if you need it. For a wide table, choose **Landscape** in the same
window.

Who sees the button is ticked per role: **Settings → Staff and roles → What
each role may do → pages.export_pdf** ("Download any staff page as a PDF"),
then **Save** under that role. **Management** and the **Admissions manager**
have it from the start. Each press is written to the audit log
(`page.pdf_downloaded`, with the page's full address, filters included, and
who pressed it); an applicant's page, their registration page and a family's
page are also filed on that applicant's or family's own Audit tab. Pressing
again on the same page within ten minutes counts as the same copy. If the
record cannot be written, the button says so and does not open the print
window. The permission controls the button, not the browser: anyone can still
use the browser's own Print, which is not recorded.

The applicant lists keep their own **Excel** and **PDF** downloads (above),
which hold the whole list rather than the page of fifty on screen.

## Exporting students to Ed-admin

**Ed-admin export** in the menu (also under Admissions → Enrolment → Student
export): choose the campus and intake, then take **two** files in the school
system's own layout.

Only the **Chief financial officer** role can see or use it (permission
`enrolment.export`; the super administrator can too). To give it to the CFO,
a super administrator opens **Set up → People**, finds the CFO and adds the
**Chief financial officer** role — an admissions manager cannot hand it out,
because it carries finance permissions they do not hold. Nobody else sees the
menu item, the Enrolment switch or the page.

1. **Parent details (Excel)** — the guardians and their contact details, one
   row per family. Take this one first. It changes nothing, so it can be
   taken as often as you like.
2. **Student details (Excel)** — one sheet of 33 columns, one row per child.
   This is the one that records the transfer: it creates the batch and marks
   those records as sent, so the default view then shows only what is new.

The parent file is a workbook with **six tabs**, in the layout of Ed-admin's
own Parents import template. Every tab starts with the family code:

| Tab | What is on it |
| --- | --- |
| Basic | Each guardian's names, title, relation and gender; home language; salutation |
| G1 Contact | The first guardian's home phone, cell, email and nationality |
| G1 Address | The first guardian's address and up to three emergency contacts |
| G2 Contact | The second guardian's phone, cell, email and nationality |
| G2 Address | The second guardian's address |
| Accounts (By Family Code) | The billing address, phone and email |

**Import every tab, not just the first, and import Basic first.** Basic
creates each family; the other tabs add details to a family code that must
already exist. Basic has no phone numbers, emails or addresses. If every
family arrives in Ed-admin with names but none of those, the other five tabs
were not imported. One family with a gap may simply not have given that
detail: an address and a home phone are optional at registration. An email
and a mobile are not, for either guardian, on a Family step saved from
15 October 2026, and a Family step saved from that date always has a second
guardian. A family that saved it before then may not, and the G2 tabs list
only the families that have one; in a batch with none they hold only the header
row and there is nothing to import from them.

They are separate files on purpose — that system will not take parent and
student details together. The **only** thing in both is the **family code**,
which is what tells it that these parents and these children are one family.
Import the parent file first, then the student file; the codes in the second
attach each child to the account the first one opened.

A past batch can be taken again as either half, from the list at the bottom.
The pair always matches, because both are rendered from the same records.

Columns we do not collect are present and empty, because a row has to be the
same shape as the header. Among them: a guardian's profession, company, work
phone, fax and passport number; every post code; and a child's religion,
class, email and cell. An empty column of this kind does not mean the import
failed. Dates are written `dd/mm/yyyy`.

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

## Ed-admin will not take a stage it does not recognise

Ed-admin has no stage called "Stage 5". It has `Stage5-HPS` at Block 7 and
`Stage5-HLA` at Broadhurst, `NURSERY-TLK` at Tlokweng and `NURSERY_PHASE_2`
at Phase 2 — the stage and the site in one word, hyphenated at some sites and
underscored at others. Its importer matches the whole string and ignores
anything else **without saying so**, which is the trap: the row imports, the
grade does not resolve, and the child sits there with no stage and no family.
The same is true of nationality, language, title and relation.

**Set up → Ed-admin stage names** holds the mapping, one row per stage per
campus, chosen from Ed-admin's own Grade list. It is filled in already. When
the school opens a site or renames a stage in Ed-admin, change it here — not
in the code — and the next download is right.

The student export refuses to send a child whose stage has no name yet, and
says which campus and stage to fix. That refusal is deliberate: a file that
half imports is worse than one that does not go.

Ed-admin's Relation list is gendered throughout — `Guardian (female)` and
`Guardian (male)` but no plain `Guardian`, `Grandmother` but no
`Grandparent` — so registration asks each guardian for a **title**, which
Ed-admin requires anyway. Mr and Mrs settle it; a mother is a Mother whatever
her title, so records taken before the question existed still export. A
guardian who is a Dr or a Professor settles neither, and comes out blank and
reported rather than guessed from a first name — put a title on that guardian
and it resolves.

Potchefstroom is Ed-admin's **CBD**, and its stages are the South African
early years — Babies, Toddlers, Junior, Grade RR, Grade R — not the Botswana
ladder. Those five are its own stages here, offered nowhere else. Until they
were added it had fees but no stage list, so no parent could apply to it.

## A mobile number the school cannot message

Every form that asks for a mobile asks for the country first and the number
second, and checks the two together before it will accept them: a Botswana
mobile is eight digits starting with 7, a South African one is nine starting
with 6, 7 or 8, and so on down the list. What is stored is always the one
form WhatsApp accepts — `+26771234567`, no spaces, no leading zero — so a
number that saved is a number a message can reach.

Two things follow. A parent who types a landline is told so on the field
rather than at the point a message silently fails. And a number from a
country not on the list is entered under **Somewhere else** with its country
code included; the shape is checked, the network is not, so read it back to
the family.

Numbers taken before this was in place are untouched. If a message to one
fails, open the applicant, and under **Parent** choose **Correct the mobile
number**: it asks for the country and the number the same way, checks them
the same way, and records the change under your name.

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
Fill in the child, the parent, the campus and the start term — or, at Potch
CBD, Potch South and Bana Tlokweng, the month the child starts, because those
campuses take children in by the month (see below); leave **Grade** on "Work
it out from the date of birth" unless the family is transferring into a
particular year, in which case choose it — the campus must teach it.

## Moving a child on by hand (Move to stage)

For a family who has already paid, or a child the school has decided need not
sit the assessment. Needs the permission **applications.move_stage**, which
the **Admissions manager** role holds. Moving to **Offer** also records an
approval, so it needs **decisions.override** as well; **Payment** also
approves the letter, so it needs **offers.approve** too. Someone given Move to
stage without those sees only Decision and Registration.

- **From the applicant page:** under Next step, open **Move to another
  stage**, choose the stage, say why, and press **Move child**.
- **At the desk, for a new family:** on **Add applicant**, choose the stage
  under **Move straight on**. The family is added and moved in one press, and
  never receives the "book an assessment" email. If the family turns out to be
  on file already, the move is made on their existing record, or the form says
  why not.

What each stage does, and what the parent hears:

| Move to | What happens | The parent hears |
|---|---|---|
| Decision | A booked assessment is cancelled; the child waits for a decision | Nothing |
| Offer | The child is accepted (a decision is recorded with your reason) and the offer drafted; it waits for approval | The offer, once somebody approves and sends it |
| Payment | Accepted, the offer approved without emailing it, and the family's acceptance recorded on their behalf | Only what to pay (or, when nothing is payable, that registration is next) |
| Registration | Any offer in play is withdrawn; registration opens | Only that registration is due — no payment messages |

Every step skipped is on the timeline with your name and reason, and the
journey bar leaves the skipped stages unticked.

**Moving back.** From Offer, Payment or Registration a child can also go
**Back to Decision** or **Back to Offer** (needs **offers.approve**):

| Back to | What happens | The parent hears |
|---|---|---|
| Decision | Any offer the family has, or accepted, is withdrawn; an unpaid payment is cancelled; a "Decide again" task opens | Nothing until a new decision and a new offer are sent |
| Offer | The same, and a new letter is drafted at once with the old one's conditions; it waits for your approval | The new letter, once you approve and send it |

The family's signed acceptance of the old letter stays on file as what
happened. Reminders already queued for the old stages (payment, offer,
registration) are dropped, so the family does not get a reminder about a
letter that no longer stands. A move back is **refused while money is held**
for the child: money received (refund it under Payments first, or move them
forward instead), a payment still being confirmed or part-paid, a payment
the family reported that finance has not confirmed, a payment that came in
for the wrong amount (until finance marks its review task done), or an
online payment started in the last 24 hours that could still go through at
the gateway. It is not offered on screen in those cases; the page says why,
except when the money was simply received. If the page was open while the
child moved on, the move is refused and you are asked to reload, rather
than going the other way. A letter waits for approval
after Offer even when automatic offer approval is switched on. Registration
reminders to a family moved on by hand say only that registration is due,
never that "the place is secured", until a payment has been received.

**"The family says they have already paid"** (Registration only). Nothing is
ever marked paid by this: paid still means a gateway confirmation or a
receipt finance recorded. Their payment request stays open, and finance gets
a **please confirm** task. When finance records the money against it under
Payments, it is filed as the confirmation (no refund review, no email) and
the task closes. Without the tick, an open payment request is closed so
finance is not left chasing it.

Moving to **Payment** needs an active fee schedule for the campus, stage and
year; it is refused before anything changes if there is none (move to
Registration instead, or set the fees).

## The scholarship percentage on an offer

Choose it on **Admissions → Offer** (the Scholarship picker on each offer
waiting for approval) or on the applicant under **Edit offer**. It needs
**offers.approve**. Saving re-drafts the offer at that percentage:

- a draft or a letter waiting for approval is re-drafted and still waits for
  approval;
- a letter the family already has is withdrawn (their link stops working) and
  a new one waits for approval;
- once the family has accepted, their letter keeps its fees and only the
  scholarship on file changes.

The bands (10% to 50%) are promotions with `SCHOLARSHIP-` codes under
Settings → Promotions; they no longer appear in the general promotion list on
the Offer board, so the percentage is chosen in one place.

## Campuses that run by the month

Potch CBD, Potch South and Bana Tlokweng do not take children in by the term.
A family chooses the **month** the child starts — on the parent's grade step
and on **Add applicant** — and that month is what the offer letter names
("a place in our Grade R class at Potch CBD for October 2026"), what the
enrolment starts on, and what the first-day emails count from. The term is
still recorded underneath, worked out from the month, so capacity, the fee
year and every report count the child where they belong.

Which campuses work this way is set under **Settings → Campuses → Families
join by the**. On an applicant whose campus runs by the month, the **Offer**
tab has a **Starting month** box beside **Full or half day?**; older
applications at those campuses have no month yet and the letter names the
term until somebody sets one.

Potch prices the month at two rates, half day and full day, with lunch in the
price for Babies to Juniors and charged on top for Grade RR and Grade R (R400
a month in 2026, R500 in 2027).
Set **Full or half day?** on the applicant and the letter quotes that rate;
until then it quotes both and asks the family which suits them.

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

## Somebody forgot their password

**Forgotten your password?** on the sign-in page. They type their email and
we send a link — through our own templates and Resend, the same way an
invitation goes, because Supabase's own reset email never reached anybody
here. The link works once and lapses after an hour; asking again sends a
fresh one and cancels the old. It also replaces an unused invitation, so
someone who asks for a reset before ever setting a password simply sets it
from the reset link instead. The page says the same thing whether or not the
address is on the staff list.

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
13. Never delete an applicant to satisfy a data-protection request. Use
    **Data retention**, which anonymises: deleting also removes the figures
    the school reports on, and the audit line it leaves behind still names
    the child. Deleting is for records that should never have existed.
14. Never type a stage name into the Ed-admin export by hand or invent one
    that "looks right". Copy it from Ed-admin's own Grade dropdown into
    **Set up → Ed-admin stage names**. A near miss imports as nothing.
15. Never hand `applications.delete` to a role people share. It is the super
    administrator's, and one mis-click is not recoverable.
13. Never turn a medical export column on without the data-protection
    officer's say-so, and never switch `retention_enabled` on without reading
    the preview first. Anonymisation cannot be undone.
