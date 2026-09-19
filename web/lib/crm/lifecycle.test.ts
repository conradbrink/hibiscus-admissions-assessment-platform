import { describe, expect, it } from "vitest";
import { LIFECYCLE_BLURB, LIFECYCLE_LABELS, LIFECYCLE_STAGES, PIPELINE_STAGES, deriveLifecycle, isLifecycleStage } from "@/lib/crm/lifecycle";

describe("deriveLifecycle", () => {
  it("is a new enquiry when nothing has happened yet", () => {
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: [], reenrolmentOutstanding: 0 })).toBe("new_enquiry");
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: ["new_enquiry"], reenrolmentOutstanding: 0 })).toBe("new_enquiry");
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: ["callback_requested"], reenrolmentOutstanding: 0 })).toBe("new_enquiry");
  });

  it("climbs the funnel with the application", () => {
    const at = (s: Parameters<typeof deriveLifecycle>[0]["applicationStatuses"][number]) => deriveLifecycle({ studentStatuses: [], applicationStatuses: [s], reenrolmentOutstanding: 0 });
    expect(at("visit_booked")).toBe("qualified");
    expect(at("assessment_booked")).toBe("applicant");
    expect(at("assessment_in_progress")).toBe("assessment");
    expect(at("awaiting_decision")).toBe("assessment");
    expect(at("approved")).toBe("offer");
    expect(at("waitlisted")).toBe("offer");
    expect(at("offer_sent")).toBe("offer");
    expect(at("offer_accepted")).toBe("onboarding");
    expect(at("paid")).toBe("onboarding");
    expect(at("enrolled")).toBe("onboarding");
  });

  it("takes the furthest application when there are several", () => {
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: ["new_enquiry", "offer_sent", "visit_booked"], reenrolmentOutstanding: 0 })).toBe("offer");
  });

  it("is active once a child attends, whatever the applications say", () => {
    expect(deriveLifecycle({ studentStatuses: ["active"], applicationStatuses: ["new_enquiry"], reenrolmentOutstanding: 0 })).toBe("active");
    expect(deriveLifecycle({ studentStatuses: ["on_leave"], applicationStatuses: [], reenrolmentOutstanding: 0 })).toBe("active");
    expect(deriveLifecycle({ studentStatuses: ["onboarding"], applicationStatuses: [], reenrolmentOutstanding: 0 })).toBe("onboarding");
  });

  it("puts an unanswered re-enrolment question above everything", () => {
    expect(deriveLifecycle({ studentStatuses: ["active"], applicationStatuses: [], reenrolmentOutstanding: 1 })).toBe("reenrolment");
  });

  it("is alumni when every child has left and nothing is open; inactive when the last enquiry died", () => {
    expect(deriveLifecycle({ studentStatuses: ["left"], applicationStatuses: ["enrolled"], reenrolmentOutstanding: 0 })).toBe("onboarding");
    expect(deriveLifecycle({ studentStatuses: ["graduated"], applicationStatuses: ["declined"], reenrolmentOutstanding: 0 })).toBe("alumni");
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: ["withdrawn"], reenrolmentOutstanding: 0 })).toBe("inactive");
    expect(deriveLifecycle({ studentStatuses: [], applicationStatuses: ["declined", "offer_declined"], reenrolmentOutstanding: 0 })).toBe("inactive");
  });

  it("a child who left does not hide a sibling's live application", () => {
    expect(deriveLifecycle({ studentStatuses: ["left"], applicationStatuses: ["assessment_booked"], reenrolmentOutstanding: 0 })).toBe("applicant");
  });
});

describe("the stage lists", () => {
  it("label and blurb every stage", () => {
    for (const s of LIFECYCLE_STAGES) {
      expect(LIFECYCLE_LABELS[s]).toBeTruthy();
      expect(LIFECYCLE_BLURB[s]).toBeTruthy();
    }
  });
  it("pipeline is every stage but inactive, in order", () => {
    expect(PIPELINE_STAGES).toEqual(LIFECYCLE_STAGES.filter((s) => s !== "inactive"));
  });
  it("isLifecycleStage guards a query string", () => {
    expect(isLifecycleStage("active")).toBe(true);
    expect(isLifecycleStage("Active")).toBe(false);
    expect(isLifecycleStage(null)).toBe(false);
    expect(isLifecycleStage("")).toBe(false);
  });
});
