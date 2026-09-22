import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "@/lib/supabase/types";
import type { NextAction } from "@/lib/workflow/states";
import {
  assertTransition,
  canBeDecided,
  canTransition,
  IllegalTransitionError,
  NEXT_ACTION_KEYS,
  NEXT_ACTIONS,
  nextActionCopy,
  PIPELINE_GROUPS,
  STATUS_LABELS,
  STATUS_TONE,
  statusAfterBooking,
  statusAfterCancellation,
  statusAfterVisitArrival,
  bookingTrackNextAction,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from "@/lib/workflow/states";

const ALL = Object.keys(TRANSITIONS) as ApplicationStatus[];

describe("state machine", () => {
  // The board is the funnel. Two statuses are off it on purpose: `withdrawn`,
  // which left, and `deferred`, which is paused at the family's request and
  // would otherwise sit in a column reading as work nobody has done. Both are
  // still named and toned, because both are shown on the applicant.
  const OFF_BOARD: ApplicationStatus[] = ["withdrawn", "deferred"];

  it("names every status once in the board and gives each a label and tone", () => {
    const onBoard = new Set(PIPELINE_GROUPS.flatMap((g) => g.statuses));
    for (const s of ALL) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
      if (!OFF_BOARD.includes(s)) expect(onBoard.has(s)).toBe(true);
    }
    const counted = PIPELINE_GROUPS.flatMap((g) => g.statuses);
    expect(new Set(counted).size).toBe(counted.length);
  });

  it("keeps the off-board statuses out of the columns, and only those", () => {
    const onBoard = new Set(PIPELINE_GROUPS.flatMap((g) => g.statuses));
    expect(ALL.filter((s) => !onBoard.has(s)).sort()).toEqual([...OFF_BOARD].sort());
  });

  it("lets a deferred family come back, and does not strand them", () => {
    // The reason it exists: reversible in one click. A status a family cannot
    // come back from is the Withdraw it was invented to replace.
    expect(canTransition("deferred", "awaiting_decision")).toBe(true);
    expect(canTransition("deferred", "withdrawn")).toBe(true);
    expect(TERMINAL_STATUSES.has("deferred")).toBe(false);
    // And every point a family might say "not now" can reach it.
    for (const from of ["new_enquiry", "visit_booked", "callback_requested", "awaiting_decision", "staff_review"] as ApplicationStatus[]) {
      expect(canTransition(from, "deferred")).toBe(true);
    }
  });

  it("only ever points at real statuses", () => {
    for (const s of ALL) for (const to of TRANSITIONS[s]) expect(ALL).toContain(to);
  });

  it("terminal states go nowhere, not even to withdrawn", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(TRANSITIONS[s]).toEqual([]);
      expect(canTransition(s, "withdrawn")).toBe(false);
    }
  });

  it("every non-terminal state can be withdrawn", () => {
    for (const s of ALL) {
      if (!TERMINAL_STATUSES.has(s)) expect(canTransition(s, "withdrawn")).toBe(true);
    }
  });

  it("every state is reachable from new_enquiry", () => {
    const seen = new Set<ApplicationStatus>(["new_enquiry"]);
    const queue: ApplicationStatus[] = ["new_enquiry"];
    while (queue.length) {
      const s = queue.shift()!;
      for (const to of [...TRANSITIONS[s], ...(canTransition(s, "withdrawn") ? ["withdrawn" as const] : [])]) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it("walks the happy path end to end", () => {
    const path: ApplicationStatus[] = [
      "new_enquiry",
      "assessment_booked",
      "assessment_in_progress",
      "assessment_completed",
      "awaiting_decision",
      "approved",
      "offer_draft",
      "offer_pending_approval",
      "offer_sent",
      "offer_accepted",
      "payment_required",
      "payment_processing",
      "paid",
      "registration_incomplete",
      "registration_complete",
      "enrolled",
    ];
    for (let i = 1; i < path.length; i++) expect(() => assertTransition(path[i - 1], path[i])).not.toThrow();
  });

  it("walks the pre-school path, which skips assessment", () => {
    expect(canTransition("new_enquiry", "awaiting_decision")).toBe(true);
  });

  it("refuses the moves that would skip a gate", () => {
    expect(() => assertTransition("new_enquiry", "paid")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("offer_sent", "enrolled")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("assessment_booked", "approved")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("declined", "approved")).toThrow(IllegalTransitionError);
  });

  it("agrees with the graph about who can be decided", () => {
    // The profile page used to carry its own list of decidable statuses and it
    // drifted, so staff were shown an Approve button that always failed. A loop
    // rather than a handful of cases, because the point is that the two can
    // never disagree again.
    for (const s of ALL) expect(canBeDecided(s)).toBe(canTransition(s, "approved"));
  });

  it("will not let a booked visit be approved until the child has arrived", () => {
    // A play date that has been booked is not yet a play date that happened.
    // Checking in is what moves it, and only then is there something to decide.
    expect(canBeDecided("visit_booked")).toBe(false);
    expect(canTransition("visit_booked", "awaiting_decision")).toBe(true);
    expect(canBeDecided("awaiting_decision")).toBe(true);
  });

  it("does not offer a decision straight from an enquiry or a callback", () => {
    expect(canBeDecided("new_enquiry")).toBe(false);
    expect(canBeDecided("callback_requested")).toBe(false);
  });

  it("hands a pre-school child to the decision when they arrive for their play date", () => {
    expect(statusAfterVisitArrival("visit_booked", false)).toBe("awaiting_decision");
    expect(canBeDecided(statusAfterVisitArrival("visit_booked", false)!)).toBe(true);
  });

  it("does not walk a child past the assessment they have not sat", () => {
    // A primary family can book a look-around visit through the visit door,
    // and it is stored as the same kind as a play date. Arriving for it must
    // not move them on: the assessment is still ahead of them.
    expect(statusAfterVisitArrival("visit_booked", true)).toBeNull();
    expect(statusAfterVisitArrival("new_enquiry", true)).toBeNull();
  });

  it("leaves a family who are already past the decision where they are", () => {
    // Walking round the campus with an offer in hand is not a return to the
    // decision. Same reasoning as `statusAfterBooking`.
    for (const s of ["offer_sent", "paid", "enrolled"] as ApplicationStatus[]) {
      expect(statusAfterVisitArrival(s, false)).toBeNull();
    }
  });

  it("has copy for every next action", () => {
    for (const k of NEXT_ACTION_KEYS) {
      expect(NEXT_ACTIONS[k].parentTitle).toBeTruthy();
      expect(NEXT_ACTIONS[k].staffLabel).toBeTruthy();
    }
  });

  it("walks the Phase 3 path from a sent offer to enrolment", () => {
    const path: ApplicationStatus[] = [
      "offer_sent",
      "offer_accepted",
      "payment_required",
      "payment_processing",
      "payment_required",
      "payment_processing",
      "paid",
      "registration_incomplete",
      "registration_complete",
      "enrolled",
    ];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
    // A bank transfer settles without a processing step.
    expect(canTransition("payment_required", "paid")).toBe(true);
    // Once submitted, registration does not reopen: corrections are a task.
    expect(canTransition("registration_complete", "registration_incomplete")).toBe(false);
    // An accepted offer goes to payment and nowhere else.
    expect(TRANSITIONS.offer_accepted).toEqual(["payment_required"]);
    for (const s of ["offer_accepted", "payment_required", "payment_processing", "paid", "registration_incomplete", "registration_complete"] as ApplicationStatus[]) {
      expect(canTransition(s, "withdrawn")).toBe(true);
    }
    expect(canTransition("enrolled", "withdrawn")).toBe(false);
  });

  it("points the payment and registration actions at their pages", () => {
    expect(NEXT_ACTIONS.pay_fees.parentCta?.href).toBe("/pay");
    expect(NEXT_ACTIONS.complete_registration.parentCta?.href).toBe("/register");
    expect(NEXT_ACTIONS.review_offer.parentCta?.href).toBe("/offer");
  });

  describe("statusAfterBooking", () => {
    it("moves an enquiry to the booked status", () => {
      expect(statusAfterBooking("new_enquiry", "visit")).toBe("visit_booked");
      expect(statusAfterBooking("new_enquiry", "assessment")).toBe("assessment_booked");
      expect(statusAfterBooking("callback_requested", "visit")).toBe("visit_booked");
      expect(statusAfterBooking("no_show", "assessment")).toBe("assessment_booked");
    });

    it("leaves an application alone once it is past the booking stage", () => {
      // These four are the statuses real families were in when they booked a
      // visit and were told, in red, that it had failed — while the booking
      // was created anyway. Nothing here may move backwards.
      for (const from of ["offer_sent", "offer_pending_approval", "payment_required", "payment_processing"] as ApplicationStatus[]) {
        expect(statusAfterBooking(from, "visit")).toBeNull();
        expect(statusAfterBooking(from, "assessment")).toBeNull();
      }
    });

    it("never moves a terminal application", () => {
      for (const from of [...TERMINAL_STATUSES] as ApplicationStatus[]) {
        expect(statusAfterBooking(from, "visit")).toBeNull();
        expect(statusAfterBooking(from, "assessment")).toBeNull();
      }
    });

    it("agrees with the graph for every status", () => {
      for (const from of ALL) {
        expect(statusAfterBooking(from, "visit")).toBe(canTransition(from, "visit_booked") ? "visit_booked" : null);
        expect(statusAfterBooking(from, "assessment")).toBe(
          canTransition(from, "assessment_booked") ? "assessment_booked" : null
        );
      }
    });
  });
});

describe("statusAfterCancellation", () => {
  it("sends a family back to the start of the booking track only while the booking was the stage", () => {
    expect(statusAfterCancellation("assessment_booked")).toBe("new_enquiry");
    expect(statusAfterCancellation("visit_booked")).toBe("new_enquiry");
    expect(statusAfterCancellation("no_show")).toBe("new_enquiry");
  });

  it("leaves a pre-school family waiting on a decision, and a family holding an offer, where they are", () => {
    // The bug: a parent cancelling a play date was shown "Illegal transition:
    // awaiting_decision → new_enquiry" with the booking already cancelled.
    expect(statusAfterCancellation("awaiting_decision")).toBeNull();
    expect(statusAfterCancellation("staff_review")).toBeNull();
    expect(statusAfterCancellation("offer_sent")).toBeNull();
    expect(statusAfterCancellation("payment_required")).toBeNull();
    expect(statusAfterCancellation("new_enquiry")).toBeNull();
    expect(statusAfterCancellation("callback_requested")).toBeNull();
  });

  it("never proposes a move the graph refuses", () => {
    for (const s of Object.keys(TRANSITIONS) as ApplicationStatus[]) {
      const to = statusAfterCancellation(s);
      if (to) expect(canTransition(s, to)).toBe(true);
    }
  });

  it("names the next step by whether the child sits an assessment", () => {
    expect(bookingTrackNextAction(true)).toBe("book_assessment");
    expect(bookingTrackNextAction(false)).toBe("await_school_contact");
  });
});

describe("a change of class that adds or removes the assessment", () => {
  it("can send a child waiting on a decision back to book the sitting", () => {
    expect(canTransition("awaiting_decision", "new_enquiry")).toBe(true);
    expect(canTransition("staff_review", "new_enquiry")).toBe(true);
  });
});

describe("what a scholarship family is told to do next", () => {
  const scholar = (action: NextAction) =>
    nextActionCopy(action, { requiresAssessment: false, bookingKind: "visit", scholarship: true });

  it("asks them to book an interview, not an assessment", () => {
    // This is what shipped: the routing branch set `next_action` to
    // `book_assessment` under a comment promising "the noun makes it read
    // 'book your interview'". It did not — `nextActionCopy` rewrote only
    // `attend_visit`, and only for a play date — so a family the school had
    // told in writing there is no assessment read "Your next step is to book
    // an assessment" under a button marked "Book assessment".
    const copy = scholar("book_assessment");
    expect(copy.parentTitle).toBe("Your next step is to book the interview.");
    expect(copy.parentCta?.label).toBe("Book interview");
    expect(copy.staffLabel).toBe("Parent to book interview");
    expect(`${copy.parentTitle} ${copy.parentDetail} ${copy.parentCta?.label}`).not.toContain("assessment");
  });

  it("uses the word for attending and for rebooking too", () => {
    expect(scholar("attend_visit").parentCta?.label).toBe("View interview");
    expect(scholar("attend_assessment").parentCta?.label).toBe("View interview");
    expect(scholar("rebook_assessment").parentCta?.label).toBe("Rebook interview");
    expect(scholar("rebook_assessment").parentDetail).not.toContain("assessment");
  });

  it("leaves the other two tracks exactly as they were", () => {
    // The regression this file exists to prevent: a pre-school family must
    // still be told about a play date, and an assessed child about an
    // assessment.
    const preschool = nextActionCopy("attend_visit", { requiresAssessment: false, bookingKind: "visit", scholarship: false });
    expect(preschool.parentCta?.label).toBe("View play date");
    const assessed = nextActionCopy("book_assessment", { requiresAssessment: true, bookingKind: null, scholarship: false });
    expect(assessed.parentCta?.label).toBe("Book assessment");
  });
});
