import type { BookingNoun } from "@/lib/booking/noun";
import { formatDate, formatDateLong, formatTime } from "@/lib/format-date";
import type {
  ApplicationStatus,
  AttemptStatus,
  BookingStatus,
  MarkingStatus,
  OfferStatus,
  PaymentRequestStatus,
  TrialWeekStatus,
} from "@/lib/supabase/types";
import { APPOINTMENT_LABELS, APPOINTMENT_STATE, canCheckIn } from "@/lib/workflow/appointment";
import { STATUS_LABELS, STATUS_TONE, TERMINAL_STATUSES, type StatusTone } from "@/lib/workflow/states";

/**
 * "What do I do with this applicant now?" — answered once, from the facts.
 *
 * The applicant page used to show the parent's next action, the open tasks,
 * the booking, eight tabs and a timeline, and leave staff to work out which
 * of those was the job. This reads the same facts the page already loads and
 * says three things: where the family is in the journey, the one status that
 * describes them, and the one thing to press.
 *
 * Presentation only, like `stages.ts`. It moves nothing — every button it
 * names is an existing action that goes through the engine — and it is pure,
 * so every state the page can be in is a unit test (`next-step.test.ts`).
 *
 * The status is deliberately one line. An application and its booking each
 * keep a status, and the page used to show both, which is how one child read
 * "Assessment booked" and "Arrived" (or "No-show") at once. Here the booking
 * refines the application's status rather than sitting beside it.
 */

export type JourneyStage = "enquiry" | "assessment" | "decision" | "offer" | "payment" | "registered";

export const JOURNEY: ReadonlyArray<{ key: JourneyStage; label: string }> = [
  { key: "enquiry", label: "Enquiry" },
  { key: "assessment", label: "Assessment" },
  { key: "decision", label: "Decision" },
  { key: "offer", label: "Offer" },
  { key: "payment", label: "Payment" },
  { key: "registered", label: "Registered" },
];

/**
 * The one button. Each names an existing action the page renders; the page
 * also decides whether this person holds the permission for it.
 */
export type PrimaryAction =
  | "call_parent" // completeCallback
  | "book" // rescheduleByStaff (book a session)
  | "check_in" // checkIn
  | "launch" // LaunchDialog → launchAttempt
  | "new_code" // LaunchDialog → reissueCode
  | "open_sitting" // link to the attempt
  | "mark_writing" // link to the attempt, where the rubric is
  | "decide" // the inline decision panel
  | "trial_outcome" // TrialWeekStatus
  | "generate_offer" // generateOffer
  | "approve_offer" // approveOffer
  | "reissue_offer" // withdrawOffer, then generate
  | "resend_link" // resendLink
  | "send_outcome" // sendOutcome
  | "follow_up" // addApplicantTask, with a date
  | "record_payment" // PaymentPanel → recordEft
  | "registration_reminder" // sendRegistrationReminder
  | "confirm_registration" // confirmRegistration
  | "register" // confirmEnrolment
  | "resume" // resumeDeferred
  | "withdraw"; // recordDecision(withdrawn)

export type StepTone = "action" | "waiting" | "done" | "paused" | "closed";

export type NextStep = {
  /** Where on the journey bar. */
  stage: JourneyStage;
  /** Set when the journey stopped here rather than is under way. */
  halted: "paused" | "closed" | null;
  /** The single status for the header. */
  status: { label: string; tone: StatusTone };
  /** One line: what is true now. */
  headline: string;
  /** The step, as an instruction or (when waiting on somebody else) as a fact. */
  title: string;
  /** At most one supporting line. */
  detail: string | null;
  action: PrimaryAction | null;
  /** The words on the button. */
  actionLabel: string | null;
  tone: StepTone;
};

export type ApplicantFacts = {
  status: ApplicationStatus;
  requiresAssessment: boolean;
  /** What this family's appointment is called: assessment, visit or interview. */
  noun: BookingNoun;
  /** The live booking (booked, checked in, in progress), or null. */
  booking: { status: BookingStatus; kind: "assessment" | "visit"; startsAt: string | null; campus: string | null } | null;
  /** The newest sitting, or null. */
  attempt: { status: AttemptStatus; markingStatus: MarkingStatus; startedAt: string | null } | null;
  /** The offer still in play (not withdrawn), or null. */
  offer: { status: OfferStatus; sentAt: string | null; viewedAt: string | null; expiresAt: string | null } | null;
  /** An open `send_outcome` task: the waitlist or decline letter has not gone. */
  outcomeLetterPending: boolean;
  /** The admission payment request, or null. */
  payment: { status: PaymentRequestStatus; dueAt: string | null } | null;
  /** The newest free trial week, or null. */
  trial: { status: TrialWeekStatus; startsOn: string; endsOn: string } | null;
  deferredUntil: string | null;
  /** The `offer_auto_approve` setting: creating an offer also sends it. */
  offerAutoApprove?: boolean;
  /** The earliest open task with a due date: a follow-up already set, so it is not asked for twice. */
  followUpDueAt: string | null;
  /** Whether a sitting was ever handed in, for where a paused family sits on the bar. */
  hasSat: boolean;
  /** Whether a decision was ever recorded, likewise. */
  hasDecision: boolean;
  /** Registration open and every section done by the completeness rule: only the parent's Submit is missing. */
  registrationReady?: boolean;
  now: Date;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What the registration stage says about the money. It used to say "Payment
 * received." whatever the record held, which was true while paying was the
 * only way in; since Move to stage, a child can reach registration with the
 * payment still to confirm, or with none asked for.
 */
function paidLine(f: Pick<ApplicantFacts, "payment">): string {
  // Null is "not shown to this person" as often as "none": the payment
  // request is loaded only for those who may see payments. Saying nothing is
  // the one answer true either way.
  if (!f.payment) return "";
  if (f.payment.status === "paid") return "Payment received. ";
  if (["required", "failed", "partially_paid", "processing"].includes(f.payment.status)) return "Payment not yet confirmed. ";
  return "No payment taken. ";
}

/** Where a status sits on the journey while it is under way. */
export function journeyStageOf(status: ApplicationStatus): JourneyStage | null {
  switch (status) {
    case "new_enquiry":
    case "callback_requested":
      return "enquiry";
    case "visit_booked":
    case "assessment_booked":
    case "no_show":
    case "assessment_in_progress":
    case "assessment_completed":
      return "assessment";
    case "awaiting_decision":
    case "staff_review":
    case "waitlisted":
    case "declined":
      return "decision";
    case "approved":
    case "offer_draft":
    case "offer_pending_approval":
    case "offer_sent":
    case "offer_expired":
    case "offer_declined":
      return "offer";
    case "offer_accepted":
    case "payment_required":
    case "payment_processing":
      return "payment";
    case "paid":
    case "registration_incomplete":
    case "registration_complete":
    case "enrolled":
      return "registered";
    case "deferred":
    case "withdrawn":
      return null;
  }
}

/** For a paused or closed family: the furthest point the facts show they reached. */
function reached(f: ApplicantFacts): JourneyStage {
  if (f.offer) return "offer";
  if (f.hasDecision || f.hasSat) return "decision";
  if (f.booking || f.trial) return "assessment";
  return "enquiry";
}

function when(f: ApplicantFacts): string | null {
  if (!f.booking?.startsAt) return null;
  const at = `${formatDateLong(f.booking.startsAt)} · ${formatTime(f.booking.startsAt)}`;
  return f.booking.campus ? `${at} · ${f.booking.campus}` : at;
}

/** The header status: the application's, refined by the booking or the sitting where they say more. */
function headerStatus(f: ApplicantFacts): { label: string; tone: StatusTone } {
  const plain = { label: STATUS_LABELS[f.status], tone: STATUS_TONE[f.status] };
  // A closed application says so, whatever a booking it still holds says:
  // a declined family keeps a booked visit until the letter goes.
  if (TERMINAL_STATUSES.has(f.status) || f.status === "deferred") return plain;
  const appt = f.booking ? APPOINTMENT_STATE[f.booking.status] : null;
  // Only while the booking is the stage. A visit stays checked in for good
  // once it has happened, and a family who visited and was then accepted,
  // offered and invoiced must not read "Arrived" through all of it.
  const bookingIsTheStage = f.status === "assessment_booked" || f.status === "visit_booked";
  if (appt === "arrived" && bookingIsTheStage) return { label: APPOINTMENT_LABELS.arrived, tone: "success" };
  if (f.status === "assessment_in_progress") {
    return f.attempt?.status === "ready" ? { label: "Waiting to start", tone: "info" } : plain;
  }
  if (f.status === "assessment_booked" || f.status === "visit_booked") {
    return { label: `${cap(f.noun)} booked`, tone: "info" };
  }
  if (f.status === "approved") return { label: "Accepted", tone: "success" };
  return plain;
}

export function nextStep(f: ApplicantFacts): NextStep {
  const status = headerStatus(f);
  const stage = journeyStageOf(f.status) ?? reached(f);
  const noun = f.noun;
  const Noun = cap(noun);
  // What is booked next. A primary family who came on a look-around visit
  // still has an assessment to book; their live booking is a visit, so the
  // noun alone would say "Book visit" over a picker of assessment sessions.
  const bookNoun = f.requiresAssessment && noun === "visit" ? "assessment" : noun;
  const base = { stage, status, halted: null } as const;
  const step = (s: Omit<NextStep, "stage" | "status" | "halted"> & { halted?: NextStep["halted"] }): NextStep => ({
    ...base,
    ...s,
    halted: s.halted ?? null,
  });

  // A booking nobody has arrived for yet, wherever the application is: the
  // pre-school visit is booked from `awaiting_decision`, and a primary family
  // may look round with an offer in hand. Checking them in is the job on the
  // day. Not on a closed application (`canCheckIn`).
  const bookedAhead = f.booking ? canCheckIn(f.booking.status, f.status) : false;
  const past = Boolean(f.booking?.startsAt && new Date(f.booking.startsAt).getTime() < f.now.getTime() - 3 * 3_600_000);
  const checkIn = (headline: string): NextStep =>
    step({
      headline,
      title: past ? `Did they come? Check them in, or mark a no-show` : `Check ${noun === "visit" ? "the family" : "the child"} in when they arrive`,
      detail: when(f),
      action: "check_in",
      actionLabel: "Check in",
      tone: "action",
    });

  switch (f.status) {
    case "callback_requested":
      return step({
        headline: "The parent asked to be called.",
        title: "Call the parent",
        detail: "Mark it done once you have spoken to them.",
        action: "call_parent",
        actionLabel: "Mark call done",
        tone: "action",
      });

    case "new_enquiry":
    case "visit_booked":
    case "no_show":
      if (bookedAhead) return checkIn(`${Noun} booked.`);
      // A primary family who has been round on a visit, or one at the start
      // of the track: the assessment is what is next, and the parent has a
      // link to book it themselves.
      return step({
        headline:
          f.status === "no_show"
            ? `Missed the ${noun}.`
            : f.booking?.status === "checked_in" && f.booking.kind === "visit" && f.requiresAssessment
              ? "Visited the campus. No assessment booked yet."
              : "New enquiry. Nothing booked yet.",
        title: f.status === "no_show" ? `Rebook the ${bookNoun}` : `Book ${bookNoun === "interview" ? "an interview" : bookNoun === "visit" ? "a visit" : "an assessment"}`,
        detail:
          f.status === "no_show"
            ? "The parent was emailed a link to choose a new time. Book one for them here if they call."
            : "The parent has a link to book one themselves. Book it for them here if they call.",
        action: "book",
        actionLabel: f.status === "no_show" ? `Rebook ${bookNoun}` : `Book ${bookNoun}`,
        tone: "action",
      });

    case "assessment_booked":
      if (bookedAhead) return checkIn(`${Noun} booked.`);
      if (f.booking?.status === "checked_in") {
        return step({
          headline: "Arrived.",
          title: "Ready for the assessment",
          detail: "Start it to get the code for the assessment computer.",
          action: "launch",
          actionLabel: "Start assessment",
          tone: "action",
        });
      }
      return step({
        headline: `${Noun} booked.`,
        title: `Book ${bookNoun === "assessment" ? "an assessment" : `a ${bookNoun}`}`,
        detail: "There is no live booking on file.",
        action: "book",
        actionLabel: `Book ${bookNoun}`,
        tone: "action",
      });

    case "assessment_in_progress":
      if (f.attempt?.status === "ready") {
        return step({
          headline: "Assessment started. Waiting for the code to be typed.",
          title: "Type the code on the assessment computer",
          detail: "Lost the code, or did it expire? Issue a new one.",
          action: "new_code",
          actionLabel: "Issue a new code",
          tone: "action",
        });
      }
      return step({
        headline: "Assessment in progress.",
        title: "The child is sitting the assessment",
        detail: f.attempt?.startedAt ? `Started at ${formatTime(f.attempt.startedAt)}. It hands itself in when time runs out.` : "It hands itself in when time runs out.",
        action: "open_sitting",
        actionLabel: "Open the sitting",
        tone: "waiting",
      });

    case "assessment_completed":
      if (f.attempt?.markingStatus === "awaiting_rubric") {
        return step({
          headline: "Assessment complete.",
          title: "Mark the written answers",
          detail: "The decision follows once every answer is marked.",
          action: "mark_writing",
          actionLabel: "Mark written answers",
          tone: "action",
        });
      }
      return step({
        headline: "Assessment complete.",
        title: "Being marked",
        detail: "The result and the decision follow automatically.",
        action: "open_sitting",
        actionLabel: "Open the sitting",
        tone: "waiting",
      });

    case "awaiting_decision":
    case "staff_review": {
      if (bookedAhead) return checkIn(`${Noun} booked.`);
      const liveTrial = f.trial && (f.trial.status === "invited" || f.trial.status === "confirmed");
      if (liveTrial && f.trial) {
        return step({
          headline: `Free trial week ${f.trial.status === "confirmed" ? "confirmed" : "offered"}.`,
          title: "Record how the trial week went, then decide",
          detail: `${formatDate(f.trial.startsOn)} to ${formatDate(f.trial.endsOn)}`,
          action: "trial_outcome",
          actionLabel: "Record trial week",
          tone: "action",
        });
      }
      if (!f.requiresAssessment && !f.hasSat) {
        return step({
          headline: f.booking?.status === "checked_in" ? `${Noun} done.` : "New enquiry.",
          title: f.booking?.status === "checked_in" ? "Decide on a place" : "Review the enquiry",
          detail: "Accept, waitlist or decline — or offer a free trial week first.",
          action: "decide",
          actionLabel: f.booking?.status === "checked_in" ? "Make decision" : "Review enquiry",
          tone: "action",
        });
      }
      return step({
        headline: f.hasSat ? "Assessment complete. Decision required." : "Decision required.",
        title: "Review the assessment and decide",
        detail: f.status === "staff_review" ? "The admission rules passed this to a person." : null,
        action: "decide",
        actionLabel: "Make decision",
        tone: "action",
      });
    }

    case "approved":
    case "offer_draft":
      return step({
        headline: "Applicant accepted. Offer needs to be sent.",
        title: "Create the offer",
        detail:
          f.offer?.status === "draft"
            ? "The last draft had no fee schedule. Set the fees for this campus and stage, then create it again."
            : "It is checked and approved before it goes to the parent.",
        action: "generate_offer",
        // Only says "send" when it does: with offer_auto_approve on, creating
        // the offer approves and sends it in the same step.
        actionLabel: f.offerAutoApprove ? "Create & send offer" : "Create offer",
        tone: "action",
      });

    case "offer_pending_approval":
      return step({
        headline: "Applicant accepted. Offer ready.",
        title: "Approve and send the offer",
        detail: "Check the letter and the fees, then send it to the parent.",
        action: "approve_offer",
        actionLabel: "Approve & send offer",
        tone: "action",
      });

    case "offer_sent":
      if (bookedAhead) return checkIn("Offer sent. Visit booked.");
      return step({
        headline: "Offer sent.",
        title: "Waiting for the parent to accept",
        detail: [
          f.offer?.sentAt ? `Sent ${formatDate(f.offer.sentAt)}` : null,
          f.offer?.viewedAt ? `opened ${formatDate(f.offer.viewedAt)}` : "not opened yet",
          f.offer?.expiresAt ? `open until ${formatDate(f.offer.expiresAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        action: "resend_link",
        actionLabel: "Email parent a fresh link",
        tone: "waiting",
      });

    case "offer_expired":
      return step({
        headline: "The offer expired.",
        title: "Withdraw the expired offer, then create a fresh one",
        detail: "Or close the application under More actions if the family has gone elsewhere.",
        action: "reissue_offer",
        actionLabel: "Withdraw expired offer",
        tone: "action",
      });

    case "offer_declined":
      return step({
        headline: "The parent declined the offer.",
        title: "Close the application",
        detail: "Withdraw it with their reason so the figures stay honest.",
        action: "withdraw",
        actionLabel: "Withdraw application",
        tone: "action",
      });

    case "offer_accepted":
    case "payment_required":
      return step({
        headline: "Offer accepted. Payment required.",
        title: "Record the payment when it arrives",
        detail: f.payment?.dueAt
          ? `Due ${formatDate(f.payment.dueAt)}. Online payments record themselves; record a bank transfer here.`
          : "Online payments record themselves; record a bank transfer here.",
        action: "record_payment",
        actionLabel: "Record payment",
        tone: "action",
      });

    case "payment_processing":
      return step({
        headline: "Online payment in progress.",
        title: "Waiting for the gateway to confirm",
        detail: "Check it with the gateway if it is taking long.",
        action: "record_payment",
        actionLabel: "Check payment status",
        tone: "waiting",
      });

    case "paid":
      return step({
        headline: "Payment received.",
        title: "Registration is opening for the parent",
        detail: null,
        action: null,
        actionLabel: null,
        tone: "waiting",
      });

    case "registration_incomplete":
      // Everything is in and only the parent's Submit is missing: they
      // finished a section after submitting, or the office uploaded the last
      // document for them, and nothing moves a registration on but Submit.
      if (f.registrationReady) {
        return step({
          headline: `${paidLine(f)}Registration filled in.`,
          title: "Everything is in — confirm the registration",
          detail: "The parent has not pressed Submit. Check the registration, then confirm it for them.",
          action: "confirm_registration",
          actionLabel: "Confirm registration",
          tone: "action",
        });
      }
      return step({
        headline: `${paidLine(f)}Registration open.`,
        title: "Waiting for the parent to complete registration",
        detail: "Their link asks only for what the school does not have yet.",
        action: "registration_reminder",
        actionLabel: "Send registration reminder",
        tone: "waiting",
      });

    case "registration_complete":
      return step({
        headline: `${paidLine(f)}Registration complete.`,
        title: "Register the student",
        detail: "Check the documents, then confirm the enrolment.",
        action: "register",
        actionLabel: "Register student",
        tone: "action",
      });

    case "enrolled":
      return step({
        headline: "Registered.",
        title: "Application complete",
        detail: "The child is on the school register.",
        action: null,
        actionLabel: null,
        tone: "done",
      });

    case "waitlisted":
      if (f.outcomeLetterPending) {
        return step({
          headline: "Applicant placed on the waitlist.",
          title: "Send the waitlist letter",
          detail: "The parent has not been told yet.",
          action: "send_outcome",
          actionLabel: "Send waitlist letter",
          tone: "action",
          halted: "paused",
        });
      }
      if (f.followUpDueAt) {
        return step({
          headline: "Applicant is on the waitlist.",
          title: `Follow up on ${formatDate(f.followUpDueAt)}`,
          detail: "The follow-up is under Tasks. Accept them from here when a place opens.",
          action: null,
          actionLabel: null,
          tone: "paused",
          halted: "paused",
        });
      }
      return step({
        headline: "Applicant is on the waitlist.",
        title: "Set a follow-up date",
        detail: "Accept them from here when a place opens.",
        action: "follow_up",
        actionLabel: "Set follow-up date",
        tone: "paused",
        halted: "paused",
      });

    case "declined":
      if (f.outcomeLetterPending) {
        return step({
          headline: "Applicant declined.",
          title: "Send the decline letter",
          detail: f.booking?.status === "booked" ? "Their booking is cancelled when the letter goes." : "The parent has not been told yet.",
          action: "send_outcome",
          actionLabel: "Send decline letter",
          tone: "action",
          halted: "closed",
        });
      }
      return step({
        headline: "Applicant declined.",
        title: "Nothing more to do",
        detail: "The parent has been told.",
        action: null,
        actionLabel: null,
        tone: "closed",
        halted: "closed",
      });

    case "deferred":
      return step({
        headline: f.deferredUntil ? `Deferred until ${formatDateLong(f.deferredUntil)}.` : "Deferred.",
        title: "Paused at the family's request",
        detail: "Resume when they are ready. We remind them, and you, around the date.",
        action: "resume",
        actionLabel: "Resume application",
        tone: "paused",
        halted: "paused",
      });

    case "withdrawn":
      return step({
        headline: "Application withdrawn.",
        title: "Nothing more to do",
        detail: null,
        action: null,
        actionLabel: null,
        tone: "closed",
        halted: "closed",
      });
  }
}

// ---------------------------------------------------------------------------
// When each stage was reached, and by whom
// ---------------------------------------------------------------------------

export type Milestone = { at: string; label: string; by: string | null };

type EventLike = { type: string; occurred_at: string; actor_type: string; actor_id: string | null; payload: unknown };

type StageRule = { type: string; label: string | ((payload: Record<string, unknown>, e: EventLike & { summary?: string }) => string) };

/**
 * The events that mark each stage done, in order of preference: the first
 * rule with a match wins, and within it the newest event. `undoneBy` names
 * events that take a stage back: an offer sent and then withdrawn is not an
 * offer out, and nothing before the newest of them counts. A child moved back
 * to Decision is waiting on a new decision, and the old one under the bar
 * would read as if it had been made already.
 */
type UndoRule = string | { type: string; when: (payload: Record<string, unknown>) => boolean };
const movedBackTo = (...stages: string[]): UndoRule => ({
  type: "application.moved_to_stage",
  when: (p) => p.direction === "back" && stages.includes(String(p.to)),
});
const payloadOf = (e: EventLike): Record<string, unknown> => (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
const undoes = (u: UndoRule, e: EventLike): boolean => (typeof u === "string" ? u === e.type : u.type === e.type && u.when(payloadOf(e)));

const STAGE_EVENTS: Record<JourneyStage, { rules: StageRule[]; undoneBy?: UndoRule[] }> = {
  enquiry: { rules: [{ type: "enquiry.created", label: "Enquiry received" }] },
  assessment: {
    rules: [
      { type: "assessment.completed", label: "Assessment completed" },
      // The same event for both kinds of booking; its summary says which.
      { type: "booking.checked_in", label: (_p, e) => (/visit/i.test(e.summary ?? "") ? "Visited" : "Checked in") },
    ],
  },
  decision: {
    rules: [
      {
        type: "decision.made",
        label: (p) => (p.outcome === "approved" ? "Accepted" : p.outcome === "waitlisted" ? "Waitlisted" : p.outcome === "declined" ? "Declined" : "Decided"),
      },
    ],
    undoneBy: [movedBackTo("decision")],
  },
  offer: {
    rules: [
      { type: "offer.accepted", label: "Offer accepted" },
      { type: "offer.sent", label: "Offer sent" },
    ],
    undoneBy: ["offer.withdrawn"],
  },
  // Only a settlement of nothing can be behind a move back (money held
  // refuses it), and it belonged to the letter that was withdrawn.
  payment: { rules: [{ type: "payment.confirmed", label: "Paid" }], undoneBy: [movedBackTo("decision", "offer")] },
  registered: { rules: [{ type: "enrolment.completed", label: "Registered" }] },
};

/** Every event type the milestones read, for the query that fetches them. */
export const MILESTONE_EVENT_TYPES: string[] = [
  ...new Set(Object.values(STAGE_EVENTS).flatMap((x) => [...x.rules.map((r) => r.type), ...(x.undoneBy ?? []).map((u) => (typeof u === "string" ? u : u.type))])),
];

/**
 * What the journey bar writes under each stage: when it was reached and who
 * did it. Events come newest first, so a re-decision or a re-sent offer
 * shows the latest.
 */
export function journeyMilestones(events: readonly (EventLike & { summary?: string })[], nameOf: (staffId: string) => string | null): Partial<Record<JourneyStage, Milestone>> {
  const out: Partial<Record<JourneyStage, Milestone>> = {};
  for (const stage of Object.keys(STAGE_EVENTS) as JourneyStage[]) {
    const { rules, undoneBy = [] } = STAGE_EVENTS[stage];
    // Only what happened since the stage was last undone: a letter accepted,
    // withdrawn by a move back, and followed by a new letter sent must read
    // "Offer sent", not the old acceptance.
    const cut = events.findIndex((x) => undoneBy.some((u) => undoes(u, x)));
    const since = cut === -1 ? events : events.slice(0, cut);
    for (const rule of rules) {
      const e = since.find((x) => x.type === rule.type);
      if (!e) continue;
      out[stage] = { at: e.occurred_at, label: typeof rule.label === "string" ? rule.label : rule.label(payloadOf(e), e), by: actorName(e, nameOf) };
      break;
    }
  }
  return out;
}

/** "Fiona Makopola", "the parent", "the admission rules", or null when nobody in particular. */
export function actorName(e: Pick<EventLike, "type" | "actor_type" | "actor_id">, nameOf: (staffId: string) => string | null): string | null {
  if (e.actor_type === "staff") return e.actor_id ? nameOf(e.actor_id) : null;
  if (e.actor_type === "parent") return "the parent";
  return e.type.startsWith("decision.") ? "the admission rules" : null;
}
