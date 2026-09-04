import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "@/lib/supabase/types";
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
  NEXT_ACTION_KEYS,
  NEXT_ACTIONS,
  PIPELINE_GROUPS,
  STATUS_LABELS,
  STATUS_TONE,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from "@/lib/workflow/states";

const ALL = Object.keys(TRANSITIONS) as ApplicationStatus[];

describe("state machine", () => {
  it("names every status once in the board and gives each a label and tone", () => {
    const onBoard = new Set(PIPELINE_GROUPS.flatMap((g) => g.statuses));
    for (const s of ALL) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
      if (s !== "withdrawn") expect(onBoard.has(s)).toBe(true);
    }
    const counted = PIPELINE_GROUPS.flatMap((g) => g.statuses);
    expect(new Set(counted).size).toBe(counted.length);
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

  it("has copy for every next action", () => {
    for (const k of NEXT_ACTION_KEYS) {
      expect(NEXT_ACTIONS[k].parentTitle).toBeTruthy();
      expect(NEXT_ACTIONS[k].staffLabel).toBeTruthy();
    }
  });
});
