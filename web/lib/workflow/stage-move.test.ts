import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { toPermissionSet } from "@/lib/permissions";
import { backPosition, canMoveTo, defersThroughDecision, isMoveTarget, mayMoveTo, MOVE_TARGETS, moveDirection, moveTargetLabel, moveTargetsFor, moveTargetsFrom, mootTaskTypes, movePosition, stagesSkippedByMove, type MoveTarget } from "@/lib/workflow/stage-move";
import { canBeDecided, canOverrideTransition, canTransition, OVERRIDE_TRANSITIONS, TERMINAL_STATUSES, TRANSITIONS } from "@/lib/workflow/states";

const ALL = Object.keys(TRANSITIONS) as ApplicationStatus[];

describe("move to stage: where a child may go", () => {
  it("offers the stages ahead, and Decision and Offer behind, in journey order", () => {
    expect(moveTargetsFrom("new_enquiry")).toEqual(["decision", "offer", "payment", "registration"]);
    expect(moveTargetsFrom("assessment_booked")).toEqual(["decision", "offer", "payment", "registration"]);
    expect(moveTargetsFrom("awaiting_decision")).toEqual(["offer", "payment", "registration"]);
    expect(moveTargetsFrom("waitlisted")).toEqual(["offer", "payment", "registration"]);
    expect(moveTargetsFrom("offer_sent")).toEqual(["decision", "payment", "registration"]);
    expect(moveTargetsFrom("offer_declined")).toEqual(["decision", "payment", "registration"]);
    expect(moveTargetsFrom("payment_required")).toEqual(["decision", "offer", "registration"]);
    expect(moveTargetsFrom("registration_incomplete")).toEqual(["decision", "offer"]);
  });

  it("says which way each move goes", () => {
    expect(moveDirection("new_enquiry", "offer")).toBe("forward");
    expect(moveDirection("payment_required", "offer")).toBe("back");
    expect(moveDirection("payment_required", "decision")).toBe("back");
    expect(moveDirection("offer_sent", "decision")).toBe("back");
    expect(moveDirection("registration_complete", "offer")).toBe("back");
    expect(moveTargetLabel("offer", "back")).toBe("Back to Offer");
    expect(moveTargetLabel("offer")).toBe("Offer");
  });

  it("defers from the offer stage by going back to Decision, and never from Payment on", () => {
    // The school's request of 20 October 2026: a family whose offer was
    // waiting for approval could only be withdrawn.
    const through = ALL.filter(defersThroughDecision).sort();
    expect(through).toEqual(["approved", "offer_declined", "offer_draft", "offer_expired", "offer_pending_approval", "offer_sent"]);
    for (const from of through) {
      // Each is a move back to Decision, then the ordinary deferral from there.
      expect(moveDirection(from, "decision"), from).toBe("back");
      expect(canTransition(from, "deferred"), from).toBe(false);
    }
    expect(canTransition("awaiting_decision", "deferred")).toBe(true);
    for (const from of ["waitlisted", "offer_accepted", "payment_required", "paid", "registration_incomplete"] as ApplicationStatus[]) {
      expect(defersThroughDecision(from), from).toBe(false);
    }
  });

  it("lets a deferred child go on to any stage from Decision, wherever they paused", () => {
    // A family pauses at most while waiting for a decision, so Decision is
    // never behind them: for one who paused there, it is coming back.
    for (const from of ALL.filter((s) => canTransition(s, "deferred"))) {
      expect(movePosition(from), from).not.toBeNull();
      expect(movePosition(from)!, from).toBeLessThanOrEqual(movePosition("awaiting_decision")!);
    }
    expect(moveTargetsFrom("deferred")).toEqual(["decision", "offer", "payment", "registration"]);
    expect(canTransition("deferred", "awaiting_decision")).toBe(true);
  });

  it("never moves a child at the keyboard, money in flight, or anybody finished", () => {
    for (const status of ["assessment_in_progress", "payment_processing", "paid", "enrolled", "declined", "withdrawn"] as ApplicationStatus[]) {
      expect(moveTargetsFrom(status), status).toEqual([]);
    }
    for (const status of TERMINAL_STATUSES) {
      expect(movePosition(status)).toBeNull();
      expect(backPosition(status)).toBeNull();
    }
  });

  it("never moves sideways, and goes back only to Decision or Offer", () => {
    expect(canMoveTo("offer_sent", "offer")).toBe(false);
    expect(canMoveTo("awaiting_decision", "decision")).toBe(false);
    expect(canMoveTo("payment_required", "payment")).toBe(false);
    // Nothing before the offer has a stage behind it to go back to.
    for (const status of ["new_enquiry", "assessment_booked", "awaiting_decision", "waitlisted", "deferred"] as ApplicationStatus[]) {
      expect(backPosition(status), status).toBeNull();
    }
    // Payment and Registration are never somewhere to go back to.
    expect(canMoveTo("registration_incomplete", "payment")).toBe(false);
    expect(canMoveTo("registration_complete", "registration")).toBe(false);
  });

  it("hides the way back once money has been received, and keeps the way forward", () => {
    const manager = toPermissionSet(["applications.move_stage", "offers.approve", "decisions.override"]);
    expect(moveTargetsFor("payment_required", manager, { moneyReceived: true })).toEqual(["registration"]);
    expect(moveTargetsFor("registration_incomplete", manager, { moneyReceived: true })).toEqual([]);
    expect(moveTargetsFor("payment_required", manager)).toEqual(["decision", "offer", "registration"]);
  });

  it("asks an offer approver to go back, because going back withdraws the letter", () => {
    const decides = toPermissionSet(["applications.move_stage", "decisions.override"]);
    expect(mayMoveTo(decides, "decision", "back")).toBe(false);
    expect(mayMoveTo(decides, "decision", "forward")).toBe(true);
    expect(moveTargetsFor("payment_required", decides)).toEqual(["registration"]);
    // There is no way back to Payment or Registration, whoever asks.
    expect(mayMoveTo(toPermissionSet(["admin"]), "payment", "back")).toBe(false);
  });

  it("knows its own targets and nothing else", () => {
    for (const t of MOVE_TARGETS) expect(isMoveTarget(t.key)).toBe(true);
    expect(isMoveTarget("enquiry")).toBe(false);
    expect(isMoveTarget("assessment")).toBe(false);
    expect(isMoveTarget(null)).toBe(false);
  });
});

describe("move to stage: who may make which move", () => {
  // The admissions manager's permissions, which is who the school asked for.
  const manager = toPermissionSet(["applications.read", "applications.write", "applications.move_stage", "offers.read", "offers.approve", "decisions.override"]);

  it("lets the admissions manager make every move", () => {
    expect(moveTargetsFor("new_enquiry", manager)).toEqual(["decision", "offer", "payment", "registration"]);
  });

  it("does not let Move to stage approve on the way for somebody who could not approve", () => {
    // A school that grants Move to stage to admissions staff has not given
    // them decisions or offer approval with it.
    const staff = toPermissionSet(["applications.read", "applications.write", "applications.move_stage"]);
    expect(moveTargetsFor("new_enquiry", staff)).toEqual(["decision", "registration"]);
    expect(mayMoveTo(staff, "offer")).toBe(false);
    expect(mayMoveTo(staff, "payment")).toBe(false);
    const decides = toPermissionSet(["applications.move_stage", "decisions.override"]);
    expect(mayMoveTo(decides, "offer")).toBe(true);
    expect(mayMoveTo(decides, "payment")).toBe(false);
  });

  it("offers nothing without Move to stage itself, whatever else is held", () => {
    const approver = toPermissionSet(["applications.write", "offers.approve", "decisions.override"]);
    expect(moveTargetsFor("new_enquiry", approver)).toEqual([]);
    expect(moveTargetsFor("new_enquiry", toPermissionSet(["admin"]))).toEqual(["decision", "offer", "payment", "registration"]);
  });
});

describe("move to stage: the graph it relies on", () => {
  // The two moves with edges of their own; Offer and Payment press the
  // ordinary buttons, so their first step must already be legal.
  const EDGE_FOR: Partial<Record<MoveTarget, ApplicationStatus>> = { decision: "awaiting_decision", registration: "registration_incomplete" };

  it("has an edge for every move it offers to Decision and Registration", () => {
    for (const from of ALL) {
      for (const [target, to] of Object.entries(EDGE_FOR) as Array<[MoveTarget, ApplicationStatus]>) {
        if (canMoveTo(from, target)) expect(canOverrideTransition(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("has an edge for every move back: to a decision, or to a fresh draft", () => {
    for (const from of ALL) {
      if (moveDirection(from, "decision") === "back") expect(canOverrideTransition(from, "awaiting_decision"), from).toBe(true);
      if (moveDirection(from, "offer") === "back") expect(canOverrideTransition(from, "offer_draft"), from).toBe(true);
    }
  });

  it("reaches a decision by the ordinary graph or its own edge, before Offer and Payment approve", () => {
    for (const from of ALL.filter((s) => moveDirection(s, "offer") === "forward")) {
      const pos = movePosition(from)!;
      // Before the decision stage: the override reaches awaiting_decision,
      // from where a person may decide. At it: decidable already.
      if (pos < movePosition("awaiting_decision")!) expect(canOverrideTransition(from, "awaiting_decision"), from).toBe(true);
      else expect(canBeDecided(from), from).toBe(true);
    }
  });

  it("keeps the override's moves out of the ordinary graph", () => {
    // Every screen asks `canTransition` what to offer. If an override edge
    // leaked into it, an enquiry would grow an Approve button.
    for (const [from, tos] of Object.entries(OVERRIDE_TRANSITIONS) as Array<[ApplicationStatus, ApplicationStatus[]]>) {
      for (const to of tos) {
        if (to === "awaiting_decision" && TRANSITIONS[from].includes(to)) continue;
        expect(TRANSITIONS[from].includes(to), `${from} → ${to} is in TRANSITIONS`).toBe(false);
      }
    }
    expect(canBeDecided("new_enquiry")).toBe(false);
    expect(canTransition("new_enquiry", "registration_incomplete")).toBe(false);
    expect(canOverrideTransition("new_enquiry", "registration_incomplete")).toBe(true);
  });

  it("only points the override at real statuses, and never out of a closed one", () => {
    for (const [from, tos] of Object.entries(OVERRIDE_TRANSITIONS) as Array<[ApplicationStatus, ApplicationStatus[]]>) {
      expect(ALL).toContain(from);
      expect(TERMINAL_STATUSES.has(from)).toBe(false);
      for (const to of tos) expect(ALL).toContain(to);
    }
    expect(OVERRIDE_TRANSITIONS.assessment_in_progress).toBeUndefined();
    expect(OVERRIDE_TRANSITIONS.payment_processing).toBeUndefined();
  });
});

describe("move to stage: what it tidies away", () => {
  it("closes the tasks of every stage skipped, and none of the stage landed on", () => {
    expect(mootTaskTypes("decision")).toEqual(expect.arrayContaining(["callback", "follow_up_no_show", "deferral_due"]));
    expect(mootTaskTypes("decision")).not.toContain("review_decision");
    expect(mootTaskTypes("offer")).toEqual(expect.arrayContaining(["review_decision", "send_outcome"]));
    expect(mootTaskTypes("offer")).not.toContain("approve_offer");
    expect(mootTaskTypes("payment")).toEqual(expect.arrayContaining(["approve_offer", "follow_up_declined_offer"]));
    expect(mootTaskTypes("payment")).not.toContain("payment_overdue");
    expect(mootTaskTypes("registration")).toEqual(expect.arrayContaining(["payment_overdue", "payment_failed_follow_up"]));
  });

  it("leaves finance's money tasks open whatever the move", () => {
    for (const t of MOVE_TARGETS) {
      for (const kept of ["payment_review", "payment_shortfall", "payment_refund_review", "confirm_reported_payment", "documents_missing"]) {
        expect(mootTaskTypes(t.key)).not.toContain(kept);
      }
    }
  });
});

describe("move to stage: the journey bar", () => {
  it("leaves unticked the stages a moved child went past without a record", () => {
    expect(stagesSkippedByMove("registered", { enquiry: {} }, true)).toEqual(["assessment", "decision", "offer", "payment"]);
    expect(stagesSkippedByMove("payment", { enquiry: {}, decision: {}, offer: {} }, true)).toEqual(["assessment"]);
  });

  it("changes nothing for a child nobody moved", () => {
    expect(stagesSkippedByMove("registered", {}, false)).toEqual([]);
  });
});
