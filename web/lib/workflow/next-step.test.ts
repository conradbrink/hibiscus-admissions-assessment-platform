import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { canCheckIn, canMarkNoShow } from "@/lib/workflow/appointment";
import { journeyStageOf, nextStep, type ApplicantFacts, type NextStep } from "@/lib/workflow/next-step";
import { TRANSITIONS } from "@/lib/workflow/states";

const NOW = new Date("2026-10-13T08:00:00+02:00");
const TOMORROW = "2026-10-14T08:00:00+02:00";

const facts = (over: Partial<ApplicantFacts>): ApplicantFacts => ({
  status: "new_enquiry",
  requiresAssessment: true,
  noun: "assessment",
  booking: null,
  attempt: null,
  offer: null,
  outcomeLetterPending: false,
  payment: null,
  trial: null,
  deferredUntil: null,
  hasSat: false,
  hasDecision: false,
  now: NOW,
  ...over,
});

const booked = { status: "booked" as const, kind: "assessment" as const, startsAt: TOMORROW, campus: "BroadHurst" };

/**
 * The applicant states the redesign was asked to be checked against, each
 * with the status the header must show, the step and the one button.
 */
const CASES: Array<[string, Partial<ApplicantFacts>, { status: string; stage: NextStep["stage"]; action: NextStep["action"]; label: string | null }]> = [
  ["new enquiry (pre-school)", { status: "awaiting_decision", requiresAssessment: false, noun: "visit" }, { status: "Awaiting decision", stage: "decision", action: "decide", label: "Review enquiry" }],
  ["assessment not booked", { status: "new_enquiry" }, { status: "New enquiry", stage: "enquiry", action: "book", label: "Book assessment" }],
  ["callback requested", { status: "callback_requested" }, { status: "Callback requested", stage: "enquiry", action: "call_parent", label: "Called — done" }],
  ["assessment booked", { status: "assessment_booked", booking: booked }, { status: "Assessment booked", stage: "assessment", action: "check_in", label: "Check in" }],
  ["applicant arrived", { status: "assessment_booked", booking: { ...booked, status: "checked_in" } }, { status: "Arrived", stage: "assessment", action: "launch", label: "Start assessment" }],
  [
    "assessment launched, code not typed",
    { status: "assessment_in_progress", booking: { ...booked, status: "in_progress" }, attempt: { status: "ready", markingStatus: "pending", startedAt: null } },
    { status: "Waiting to start", stage: "assessment", action: "new_code", label: "New code" },
  ],
  [
    "assessment in progress",
    { status: "assessment_in_progress", booking: { ...booked, status: "in_progress" }, attempt: { status: "in_progress", markingStatus: "pending", startedAt: NOW.toISOString() } },
    { status: "Assessment in progress", stage: "assessment", action: "open_sitting", label: "Open the sitting" },
  ],
  [
    "assessment completed, writing to mark",
    { status: "assessment_completed", attempt: { status: "submitted", markingStatus: "awaiting_rubric", startedAt: null }, hasSat: true },
    { status: "Assessment completed", stage: "assessment", action: "mark_writing", label: "Mark answers" },
  ],
  [
    "assessment completed, decision required",
    { status: "staff_review", attempt: { status: "marked", markingStatus: "complete", startedAt: null }, hasSat: true },
    { status: "Staff review", stage: "decision", action: "decide", label: "Review assessment & decide" },
  ],
  ["accepted", { status: "approved", hasSat: true, hasDecision: true }, { status: "Accepted", stage: "offer", action: "generate_offer", label: "Create offer" }],
  [
    "offer ready to approve",
    { status: "offer_pending_approval", offer: { status: "pending_approval", sentAt: null, viewedAt: null, expiresAt: null } },
    { status: "Offer pending approval", stage: "offer", action: "approve_offer", label: "Approve & send offer" },
  ],
  ["waitlisted, letter not sent", { status: "waitlisted", outcomeLetterPending: true, hasDecision: true }, { status: "Waitlisted", stage: "decision", action: "send_outcome", label: "Send waitlist letter" }],
  ["waitlisted", { status: "waitlisted", hasDecision: true }, { status: "Waitlisted", stage: "decision", action: "follow_up", label: "Set follow-up" }],
  ["declined, letter not sent", { status: "declined", outcomeLetterPending: true, hasDecision: true }, { status: "Declined", stage: "decision", action: "send_outcome", label: "Send decline letter" }],
  ["declined", { status: "declined", hasDecision: true }, { status: "Declined", stage: "decision", action: null, label: null }],
  [
    "offer sent",
    { status: "offer_sent", offer: { status: "sent", sentAt: NOW.toISOString(), viewedAt: null, expiresAt: TOMORROW } },
    { status: "Offer sent", stage: "offer", action: "resend_link", label: "Email a fresh link" },
  ],
  ["offer expired", { status: "offer_expired", offer: { status: "expired", sentAt: null, viewedAt: null, expiresAt: null } }, { status: "Offer expired", stage: "offer", action: "reissue_offer", label: "Withdraw & re-draft" }],
  ["offer declined by the parent", { status: "offer_declined" }, { status: "Offer declined", stage: "offer", action: "withdraw", label: "Withdraw application" }],
  ["offer accepted", { status: "offer_accepted" }, { status: "Offer accepted", stage: "payment", action: "record_payment", label: "Record payment" }],
  ["payment pending", { status: "payment_required", payment: { status: "required", dueAt: TOMORROW } }, { status: "Payment required", stage: "payment", action: "record_payment", label: "Record payment" }],
  ["payment received, registration open", { status: "registration_incomplete" }, { status: "Registration incomplete", stage: "registered", action: "registration_reminder", label: "Send a reminder" }],
  ["payment received, ready to register", { status: "registration_complete" }, { status: "Registration complete", stage: "registered", action: "register", label: "Register student" }],
  ["registered", { status: "enrolled" }, { status: "Enrolled", stage: "registered", action: null, label: null }],
  ["no-show", { status: "no_show" }, { status: "No-show", stage: "assessment", action: "book", label: "Rebook assessment" }],
  ["deferred", { status: "deferred", deferredUntil: "2027-01-15" }, { status: "Deferred", stage: "enquiry", action: "resume", label: "Resume application" }],
  ["withdrawn", { status: "withdrawn", hasDecision: true }, { status: "Withdrawn", stage: "decision", action: null, label: null }],
];

describe("next step, for every state staff meet", () => {
  for (const [name, over, want] of CASES) {
    it(name, () => {
      const s = nextStep(facts(over));
      expect(s.status.label).toBe(want.status);
      expect(s.stage).toBe(want.stage);
      expect(s.action).toBe(want.action);
      expect(s.actionLabel).toBe(want.label);
      expect(s.title).toBeTruthy();
      expect(s.headline).toBeTruthy();
    });
  }

  it("answers for every status the engine keeps", () => {
    for (const status of Object.keys(TRANSITIONS) as ApplicationStatus[]) {
      const s = nextStep(facts({ status }));
      expect(s.title, status).toBeTruthy();
      // Every button has words, and words never stand without a button.
      expect(Boolean(s.action), status).toBe(Boolean(s.actionLabel));
    }
  });

  it("gives every live status a place on the journey, and only paused or closed ones none", () => {
    for (const status of Object.keys(TRANSITIONS) as ApplicationStatus[]) {
      const stage = journeyStageOf(status);
      if (status === "deferred" || status === "withdrawn") expect(stage).toBeNull();
      else expect(stage, status).not.toBeNull();
    }
  });

  it("says visit, not assessment, to a family coming for a visit", () => {
    const s = nextStep(facts({ status: "awaiting_decision", requiresAssessment: false, noun: "visit", booking: { ...booked, kind: "visit" } }));
    expect(s.status.label).toBe("Awaiting decision");
    expect(s.action).toBe("check_in");
    expect(s.headline).toBe("Visit booked.");
  });

  it("asks whether a child came once the booking is in the past", () => {
    const s = nextStep(facts({ status: "assessment_booked", booking: { ...booked, startsAt: "2026-10-12T08:00:00+02:00" } }));
    expect(s.action).toBe("check_in");
    expect(s.title).toMatch(/no-show/);
  });

  it("puts the live trial week ahead of the decision", () => {
    const s = nextStep(
      facts({ status: "awaiting_decision", requiresAssessment: false, noun: "visit", trial: { status: "confirmed", startsOn: "2026-10-19", endsOn: "2026-10-23" } })
    );
    expect(s.action).toBe("trial_outcome");
  });

  it("marks paused and closed families on the bar", () => {
    expect(nextStep(facts({ status: "deferred" })).halted).toBe("paused");
    expect(nextStep(facts({ status: "waitlisted" })).halted).toBe("paused");
    expect(nextStep(facts({ status: "withdrawn" })).halted).toBe("closed");
    expect(nextStep(facts({ status: "declined" })).halted).toBe("closed");
    expect(nextStep(facts({ status: "approved" })).halted).toBeNull();
  });
});

describe("no contradictory status", () => {
  it("never shows a closed application as booked or arrived, whatever its booking says", () => {
    for (const status of ["declined", "withdrawn", "enrolled", "deferred"] as ApplicationStatus[]) {
      for (const b of ["booked", "checked_in"] as const) {
        const s = nextStep(facts({ status, booking: { ...booked, status: b } }));
        expect(s.status.label, `${status}/${b}`).not.toMatch(/booked|Arrived/i);
        expect(s.action, `${status}/${b}`).not.toBe("check_in");
      }
    }
  });

  it("never offers check-in or a no-show once the child has arrived", () => {
    for (const b of ["checked_in", "in_progress", "completed"] as const) {
      expect(canCheckIn(b, "assessment_booked")).toBe(false);
      expect(canMarkNoShow(b, "assessment", "assessment_booked")).toBe(false);
      expect(canMarkNoShow(b, "visit", "visit_booked")).toBe(false);
    }
    const arrived = nextStep(facts({ status: "assessment_booked", booking: { ...booked, status: "checked_in" } }));
    expect(arrived.status.label).toBe("Arrived");
    expect(arrived.action).not.toBe("check_in");
  });

  it("offers a no-show only for a booking nobody arrived for, on an application that can take it", () => {
    expect(canMarkNoShow("booked", "assessment", "assessment_booked")).toBe(true);
    expect(canMarkNoShow("booked", "visit", "visit_booked")).toBe(true);
    // A pre-school visit booked while awaiting a decision: the family is rung, the status stays.
    expect(canMarkNoShow("booked", "visit", "awaiting_decision")).toBe(true);
    // Past the assessment, or closed.
    expect(canMarkNoShow("booked", "assessment", "offer_sent")).toBe(false);
    expect(canMarkNoShow("booked", "visit", "declined")).toBe(false);
    expect(canMarkNoShow("no_show", "assessment", "no_show")).toBe(false);
  });

  it("never checks in a family whose application is closed", () => {
    expect(canCheckIn("booked", "declined")).toBe(false);
    expect(canCheckIn("booked", "withdrawn")).toBe(false);
    expect(canCheckIn("booked", "waitlisted")).toBe(true);
    expect(canCheckIn("booked", "offer_sent")).toBe(true);
  });
});
