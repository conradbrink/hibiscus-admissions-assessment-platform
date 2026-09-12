import { Beat, Facts, GoLook, Press, Rule, Scene, Where } from "@/components/staff/orientation/parts";

/**
 * The body of each orientation screen, keyed by slug. The list itself — order,
 * titles, how long each takes — is `lib/orientation.ts`; this is only the
 * words.
 *
 * Written as JSX rather than stored text on purpose: it names real buttons and
 * links to real pages, so when a button is renamed the typecheck and the
 * reviewer see this file in the same diff.
 */
export const ORIENTATION_BODIES: Record<string, () => React.ReactElement> = {
  "signing-in": () => (
    <>
      <Scene where="Int. Your first morning — the invitation email">
        <Beat cue="On screen">
          <p>
            An email from the school with a link. It has no expiry — it is the school&rsquo;s own invitation, not a
            password reset — so it still works next week if today gets away from you.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <ol>
            <li>Open the link and set a password.</li>
            <li>Bookmark where you land. Everything staff-facing lives under <code>/staff</code>.</li>
            <li>Sign in. You arrive at the Dashboard.</li>
          </ol>
        </Beat>
        <Beat cue="Careful" tone="care">
          <p>
            Your sign-in is yours. Every decision, note and offer approval is recorded against the person who did it,
            and that record is what the school reads back when a parent queries something months later. Never work on
            somebody else&rsquo;s session.
          </p>
        </Beat>
      </Scene>

      <h3 className="mt-6 mb-2 text-sm font-semibold">The cast — who may do what</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Eight roles. Yours decides which items appear in the left-hand menu at all: a page you may not open is not
        greyed out, it simply is not there.
      </p>
      <Facts
        head={["Role", "What it is for"]}
        rows={[
          ["Admissions staff", "Works the pipeline and assessment days. No fees, no rule changes."],
          ["Admissions manager", "All of that, plus approving offers and overriding a decision with a reason."],
          ["Assessor", "Assessment days and marking. Cannot see fees or offers."],
          ["Finance", "Payments and fee schedules. Read-only on scores."],
          ["Campus administrator", "Admissions staff, limited to the campuses assigned to them."],
          ["Management", "Reads the pipeline and the analytics. Changes nothing."],
          ["Content author", "Question banks and templates. No applicant access at all."],
          ["Super administrator", "Everything, including rules, staff and settings."],
        ]}
      />

      <Scene where="Int. Why your colleague sees more than you">
        <Beat cue="Campus scope">
          <p>
            If campuses are assigned to you, you see those families and no others — bookings, tasks, analytics, all of
            it. Somebody with <em>no</em> campuses assigned is head office and sees all nine. This is the answer to
            almost every &ldquo;why can&rsquo;t I find that child?&rdquo; in your first week.
          </p>
        </Beat>
        <Beat cue="Find out" tone="do">
          <p>
            Ask your manager which role and campuses you hold, or look at your own row under Settings &rarr; Staff and
            roles if you may open it. Knowing it saves you an hour of hunting.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  dashboard: () => (
    <>
      <Scene where="Int. Admissions office — 07:40">
        <Beat cue="On screen">
          <p>
            <strong>Today&rsquo;s assessments and play dates</strong> — every child expected today, by time, with the
            campus and which of the three it is. The heading matches your campuses: a pre-school campus never says
            &ldquo;assessment&rdquo;, because its children do not sit one.
          </p>
          <p>
            <strong>My tasks</strong> — what has been given to you, soonest first, each one a link to the child it is
            about.
          </p>
          <p>
            <strong>Pipeline</strong> — a count per stage. Click a stage to open that list of applicants.
          </p>
          <p>
            <strong>Needs attention</strong> — only what is waiting on a person. When it is empty, the day is clear.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <ol>
            <li>Read the day&rsquo;s board. Anyone arriving in the next hour, you now know about.</li>
            <li>Read My tasks and open anything due today.</li>
            <li>Work Needs attention from the top until it is empty.</li>
          </ol>
        </Beat>
        <Beat cue="Go and look" tone="do">
          <p>
            <GoLook href="/staff">Open the dashboard</GoLook> in another tab and read it top to bottom before you carry
            on here.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "a-family-arrives": () => (
    <>
      <Scene where="Ext. A parent's phone — the enquiry form">
        <Beat cue="What happens">
          <p>
            The parent chooses a campus, a grade and an intake, gives their details and the child&rsquo;s, and submits.
            The system emails them a confirmation with their reference — <code>HIS-2026-0142</code> shaped — and a link
            to their own next step. If they opted in to WhatsApp, the same moment goes out there too.
          </p>
          <p>
            From there the child needs either an <strong>assessment</strong> (primary and secondary) or, for
            pre-school, a <strong>play date</strong> or a <strong>visit</strong>. The parent picks the slot themselves
            from a calendar of what is published. You do not have to do anything for any of this to happen.
          </p>
        </Beat>
        <Beat cue="At the desk" tone="do">
          <p>
            A family in front of you, or on the phone? <Where>Applicants</Where> &rarr;{" "}
            <Press>Add an applicant</Press>. It creates the same application their own form would, and sends them the
            same emails — so never write one down &ldquo;for now&rdquo; to re-do later.
          </p>
        </Beat>
        <Beat cue="Careful" tone="care">
          <p>
            Check the email address twice. It is the address every link goes to, and an enquiry typed on a phone in a
            hurry is where most of them go wrong. You can correct it on the profile afterwards, and the parent can
            correct it themselves on the booking page.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "the-profile": () => (
    <>
      <Scene where="Int. The applicant's profile — where you will spend your day">
        <Beat cue="Getting there">
          <p>
            <Where>Applicants</Where>, then search by the child&rsquo;s name, the parent&rsquo;s name or the reference.
            Every list in the system — the day&rsquo;s board, tasks, the review queue — leads to this one page.
          </p>
        </Beat>
        <Beat cue="Top left">
          <p>
            <strong>Next action (Parent)</strong>, what the family is waiting to do, in their words. Under it,{" "}
            <strong>Next action (Staff)</strong>: what we owe them, the open tasks, and who each is on. You can write a
            new task against this child from here, with a date and a name on it.
          </p>
        </Beat>
        <Beat cue="Middle">
          <p>
            <strong>Booking</strong> — the slot they chose, with <Press>Check in</Press>, <Press>No-show</Press>,{" "}
            <Press>Cancel booking</Press> and a picker to move them to another time.
          </p>
          <p>
            Then the tabs: <strong>Assessment</strong>, <strong>Learning profile</strong>, <strong>Decision</strong>,{" "}
            <strong>Offer</strong>, <strong>Payment</strong>, <strong>Registration</strong>, <strong>WhatsApp</strong>,{" "}
            <strong>Downloads</strong>. Below them the <strong>Timeline</strong>, the <strong>Emails</strong> actually
            sent, and the audit trail.
          </p>
        </Beat>
        <Beat cue="Right column">
          <p>
            The facts: the parent&rsquo;s details (editable in place), who owns this applicant, anything the family
            said about additional needs, the stage, and <strong>Notes</strong> for colleagues.
          </p>
        </Beat>
        <Beat cue="Careful" tone="care">
          <p>
            A note is for colleagues and stays internal. It is not how you talk to a parent: every message to a family
            goes out as an email or an approved WhatsApp template, so that what was said is on the record and in the
            school&rsquo;s voice.
          </p>
        </Beat>
        <Beat cue="Go and look" tone="do">
          <p>
            <GoLook href="/staff/applications">Open Applicants</GoLook>, pick any child, and find all four corners
            before you move on.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "the-day": () => (
    <>
      <Scene where="Int. Reception — 08:55, the first family arrives">
        <Beat cue="On screen">
          <p>
            <Where>Assessment day</Where> in the menu, or <Press>Open check-in board</Press> on the dashboard. The day
            is split by session: each sitting&rsquo;s time, campus, room, how full it is and which assessor is on it.
            Under each, the children booked — with the parent&rsquo;s name and mobile, so you can ring the one who has
            not arrived without leaving the page.
          </p>
          <p>
            Change the date with <strong>Previous day</strong> / <strong>Next day</strong>, filter by campus, or type a
            name into the search box, which takes the focus when the page opens.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <ol>
            <li>
              <Press>Check in</Press> when the family walks in. That is the whole action.
            </li>
            <li>
              For an assessment, <Press>Launch</Press>. Choose the time allowance — extra time is set here, once, for a
              child who needs it.
            </li>
            <li>
              A <strong>code</strong> and a QR appear. Type the code on the assessment computer, or let the child scan
              it. <strong>It works once, and it is shown once.</strong>
            </li>
            <li>
              Closed the dialog too early? <Press>New code</Press> on the same row issues another.
            </li>
            <li>
              Nobody came? <Press>No-show</Press> — it emails them a rebooking link, so you do not also have to write.
            </li>
          </ol>
        </Beat>
        <Beat cue="Meanwhile">
          <p>
            The row keeps you posted: <em>Waiting for code</em> &rarr; <em>Sitting now</em> &rarr; <em>Handed in</em>{" "}
            &rarr; <em>Marked</em>. Click that word to open the sitting itself.
          </p>
        </Beat>
        <Beat cue="Pre-school" tone="care">
          <p>
            Nursery, Reception and the other pre-school grades sit nothing. Their morning is a <strong>play date</strong>{" "}
            or a <strong>visit</strong>: check them in, and the decision is made by the people who met the child. No
            code, no launch, no marks.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  marking: () => (
    <>
      <Scene where="Int. The staff room — after the sitting">
        <Beat cue="What marks itself">
          <p>
            Anything with a right answer is marked the moment it is handed in. What waits for a person is the written
            work.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <p>
            Open the attempt from the day&rsquo;s board. Read the child&rsquo;s writing, pick the band from the rubric
            that matches it, and the band&rsquo;s marks are awarded. Work through every section until nothing is
            waiting.
          </p>
        </Beat>
        <Beat cue="House rule" tone="care">
          <p>
            The AI may <em>suggest</em> a band from the same descriptors you are reading. It never awards one, and it
            never decides an admission. A person&rsquo;s name is on every mark and every outcome.
          </p>
        </Beat>
        <Beat cue="Then">
          <p>
            Once everything is marked the rules engine runs: a hard-fail rule violated declines, a review rule violated
            refers to a person, everything met approves — or waitlists, when the grade is full. The child reaches the{" "}
            <Where>Review queue</Where> only when a person is genuinely needed.
          </p>
          <p>
            The <strong>Learning profile</strong> tab turns the marks into words — below, approaching, meeting,
            exceeding, by competency. That is what a parent is told, not a percentage.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "the-decision": () => (
    <>
      <Scene where="Int. The applicant's profile — the Decision tab">
        <Beat cue="The five">
          <p>
            Five answers to one question — what happens to this family — in one box, beside the decisions already
            recorded.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <p>
            Pick the answer; the box then asks for what that answer needs — a date for a deferral, a reason code for a
            withdrawal, a reason in your own words for the rest — and <Press>Record decision</Press>. Anything with
            consequences asks you to confirm first.
          </p>
        </Beat>
      </Scene>

      <Facts
        head={["Choose", "What it means, and what happens next"]}
        rows={[
          ["Approve", "A place is offered. A letter is drafted at once and waits under Offers for a person to approve and send."],
          ["Waitlist", "No place now. The family is told, and stays on the list for this grade and intake."],
          ["Decline", "No place. The family is told, in the wording the school has agreed."],
          ["Defer", "“Not now.” You name a date; we message the family around it, put a call on the owner’s list for the day, and one click brings them back."],
          ["Withdraw", "“Not at all.” They are no longer applying. Bookings and open tasks are cancelled."],
        ]}
      />

      <Scene where="Int. The same box, half an hour later">
        <Beat cue="Careful" tone="care">
          <p>
            The reason is not paperwork. It is what the next colleague reads, and what the school reads back to a
            parent who asks in March why the answer was what it was. Write the sentence you would be happy to have read
            aloud.
          </p>
          <p>
            Deferring a family who has a booking cancels it and puts the seat back, and the reminders stop. That is not
            yours to undo afterwards, which is why the confirmation says it.
          </p>
        </Beat>
        <Beat cue="Who may">
          <p>
            Approve, waitlist and decline need the decisions permission — admissions manager and above. Defer and
            withdraw are open to anyone who may edit an applicant: they pause or close an application, they do not
            overrule the rules engine.
          </p>
        </Beat>
        <Beat cue="Coming back">
          <p>
            A deferred family shows a panel on the same tab — <em>Coming back to them 4 March 2027</em> — with{" "}
            <Press>They are ready — resume</Press>. Use it the moment they say yes, whether that is the date we
            promised or a fortnight early.
          </p>
        </Beat>
        <Beat cue="The queue" tone="do">
          <p>
            <GoLook href="/staff/decisions">Review queue</GoLook> is the same decision, gathered: everyone waiting on a
            person, oldest first. Working from there rather than from search is how a family stops waiting three weeks
            for a yes.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "offer-and-money": () => (
    <>
      <Scene where="Int. Offers & outcomes">
        <Beat cue="On screen">
          <p>
            Every draft waiting for approval, everything sent, and what each family did with it — opened, accepted,
            expired. The fees come from the narrowest fee schedule covering that child&rsquo;s campus, year and grade,
            in that campus&rsquo;s currency.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <ul>
            <li>Read the letter as rendered, not as a template. It is the version the parent will see.</li>
            <li>
              Conditions to add — &ldquo;subject to a satisfactory report from the current school&rdquo; — go on before
              you approve: add them and re-draft.
            </li>
            <li>
              <Press>Approve &amp; send</Press> is the moment it reaches the family.
            </li>
            <li>
              Sent something wrong? <Press>Withdraw &amp; re-draft</Press>. The parent&rsquo;s link stops working and a
              corrected letter can go out.
            </li>
          </ul>
        </Beat>
        <Beat cue="Pre-school">
          <p>
            On the <strong>Offer</strong> tab of a pre-school applicant you will also find{" "}
            <strong>Full or half day?</strong> — it decides which term fee the next letter quotes. While it is
            undecided the letter shows both rates and asks the family to confirm.
          </p>
        </Beat>
        <Beat cue="The parent's side">
          <p>
            They open their own page, read the letter, accept, and are shown what secures the place. They pay by card,
            or the school records a bank transfer. An offer fully waived by a promotion skips payment entirely.
          </p>
        </Beat>
        <Beat cue="House rule" tone="care">
          <p>
            A place is <strong>paid</strong> only on a verified gateway payment or a transfer recorded by finance under{" "}
            <Where>Payments</Where>. Never mark anything paid on a promise, a screenshot or a phone call.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "registration-and-after": () => (
    <>
      <Scene where="Int. Registrations — the paperwork stretch">
        <Beat cue="On screen">
          <p>
            Per family: what they still have to give us, the documents to check, and enrolment to confirm. The parent
            fills in the registration form themselves, signs the school&rsquo;s agreements by typing their name, and
            uploads what is required.
          </p>
        </Beat>
        <Beat cue="You do" tone="do">
          <ul>
            <li>
              Open each document and accept or reject it. A rejected <em>required</em> document holds enrolment; an
              optional one never does.
            </li>
            <li>Chase what is missing with the reminder that exists for it, rather than a letter you write yourself.</li>
            <li>
              Confirm enrolment. The child becomes a <strong>student</strong>, with a student code.
            </li>
          </ul>
        </Beat>
        <Beat cue="After that">
          <p>
            <Where>Students</Where> — every enrolled child and where they are now. <Where>Onboarding</Where> — what each
            new family still owes us and what we owe them, through to the first day and the first-week check-in.{" "}
            <Where>Re-enrolment</Where> — each term, asking whether the child is coming back and checking what we hold
            is still true. <Where>Student export</Where> — a batch file for the school&rsquo;s other system.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "tasks-and-trouble": () => (
    <>
      <Scene where="Int. Tasks">
        <Beat cue="Reading them">
          <p>
            <Where>Tasks</Where> lists what needs doing, oldest due first, with tabs for <em>All open</em>,{" "}
            <em>Mine</em>, <em>Unassigned</em>, <em>Overdue</em> and <em>Done</em>. Some are written by the system — a
            call to make, a family to chase — and some by people.
          </p>
        </Beat>
        <Beat cue="Writing one" tone="do">
          <p>
            Managers, management and the super administrator can add a task: what needs doing, which campus, who it is
            for, when it is due. Everyone can see it; the person it is for — and anyone covering for them — ticks it
            off. A ticked task greys out and strikes through, and stays on the list for a week before settling into
            Done, so it does not vanish from under your cursor.
          </p>
          <p>
            A task about a particular child is best written from that child&rsquo;s profile, under{" "}
            <strong>Next action (Staff)</strong>: it then carries a link back to them.
          </p>
        </Beat>
      </Scene>

      <Facts
        head={["When this happens", "Go here"]}
        rows={[
          ["“I never got the link”", "The applicant’s profile — resend their next-step link."],
          ["They want another time", "The Booking box — pick a slot and move them. The family is told."],
          ["Nobody arrived", "The check-in board — No-show. A rebooking link goes out."],
          ["“Call me later in the year”", "Decision tab — Defer, with the date they named."],
          ["“We’ve taken another school”", "Decision tab — Withdraw, with the reason code."],
          ["Wrong details on the enquiry", "The right-hand column of the profile — edit them in place."],
          ["An email did not arrive", "The Emails list on the profile shows what was sent and its state; ask an administrator to check the job queue."],
        ]}
      />

      <Scene where="Int. The one thing not to do">
        <Beat cue="Never" tone="care">
          <p>
            Never delete an applicant to tidy up. <strong>Withdraw</strong> is what you want for a family who is no
            longer applying — it keeps the figures honest. Deletion exists for a record that should never have existed,
            and only the super administrator has it.
          </p>
        </Beat>
      </Scene>
    </>
  ),

  "settings-and-rules": () => (
    <>
      <Scene where="Int. Settings — one door, entered with a reason">
        <Beat cue="What is behind it">
          <p>
            Everything the process reads its configuration from. Change something here and every applicant from that
            moment follows the new rule. Most people never need to open it.
          </p>
        </Beat>
        <Beat cue="Careful" tone="care">
          <p>
            Editing a template or an agreement publishes a <em>new version</em>. Families who already signed, and
            offers already sent, keep the version they saw. That is deliberate — and it is why &ldquo;just fixing the
            wording&rdquo; is a decision, not a typo fix.
          </p>
        </Beat>
      </Scene>

      <Facts
        head={["Group", "What is behind it"]}
        rows={[
          ["Assessments", "Question banks, the paper each grade sits, writing rubrics, benchmarks, competencies, and the admission rules."],
          ["Calendar", "The sessions parents can book, and the school holidays on which none are created."],
          ["Letters and messages", "The offer letter, every email, their WhatsApp companions, the agreements a parent signs, the documents required, the onboarding checklist."],
          ["Fees", "Fee schedules and bank details; promotions, discounts and gifts."],
          ["The school", "Campuses, grades, academic years and intakes, staff and roles."],
          ["System", "Workflow settings, data retention, export columns, and — for administrators — the outbox and job queue."],
        ]}
      />

      <h3 className="mt-6 mb-3 text-sm font-semibold">Five things that are always true</h3>
      <Rule n="One">
        <p>
          <strong>Nothing reaches a parent until a person sends it.</strong> Offers and outcomes wait for approval, by
          design.
        </p>
      </Rule>
      <Rule n="Two">
        <p>
          <strong>The AI never decides an admission.</strong> It can summarise, suggest a band, and read a document. A
          person&rsquo;s name is on every outcome.
        </p>
      </Rule>
      <Rule n="Three">
        <p>
          <strong>Paid means paid.</strong> A verified gateway payment, or a bank transfer recorded by finance. Nothing
          else.
        </p>
      </Rule>
      <Rule n="Four">
        <p>
          <strong>Each campus team sees its own school.</strong> If you cannot see a family, that is the system
          working, not a fault.
        </p>
      </Rule>
      <Rule n="Five">
        <p>
          <strong>It is all written down.</strong> Every decision, note and message is on the timeline and in the audit
          trail, under the name of whoever did it.
        </p>
      </Rule>

      <h3 className="mt-6 mb-3 text-sm font-semibold">Words you will hear</h3>
      <Facts
        head={["Word", "Means"]}
        rows={[
          ["Assessment", "The sitting a primary or secondary applicant does on a computer."],
          ["Play date", "A pre-school child’s morning with us. No marks, no computer."],
          ["Visit", "A family coming to see a campus before deciding."],
          ["Attempt", "One child’s sitting of one paper, from launch to marked."],
          ["Learning profile", "What the result says about the child, in competencies rather than a mark."],
          ["Deferred", "Paused at the family’s request, with a date to come back to them."],
          ["Withdrawn", "Closed because the family is no longer applying."],
          ["Companion", "The WhatsApp message that goes out beside an email."],
          ["Intake", "The term and academic year a child would join."],
        ]}
      />
    </>
  ),
};
