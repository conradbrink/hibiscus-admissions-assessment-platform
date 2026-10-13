import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { toPermissionSet } from "@/lib/permissions";
import { TRANSITIONS } from "@/lib/workflow/states";
import { ADMISSIONS_ENTRIES, ADMISSIONS_PATHS, OUTSIDE_STAGES, STAGES, STAGE_VIEWS, stageOf, visibleViews } from "@/lib/workflow/stages";

const ALL = Object.keys(TRANSITIONS) as ApplicationStatus[];

describe("admissions stages", () => {
  it("puts every status in exactly one stage, or deliberately in none", () => {
    const placed = [...STAGES.flatMap((s) => s.statuses), ...OUTSIDE_STAGES];
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual([...ALL].sort());
  });

  it("follows the journey in order, and finds a status's stage", () => {
    expect(STAGES.map((s) => s.key)).toEqual(["new", "assessment", "decision", "offer", "enrolment", "completed"]);
    expect(stageOf("new_enquiry")).toBe("new");
    expect(stageOf("visit_booked")).toBe("assessment");
    expect(stageOf("staff_review")).toBe("decision");
    expect(stageOf("approved")).toBe("offer");
    expect(stageOf("offer_accepted")).toBe("enrolment");
    expect(stageOf("enrolled")).toBe("completed");
    expect(stageOf("deferred")).toBeNull();
  });

  it("gives every stage its list, last, so any stage can be searched", () => {
    for (const views of Object.values(STAGE_VIEWS)) {
      expect(views.at(-1)?.key).toBe("list");
    }
  });

  it("offers only the views a person may open, the boards before the list", () => {
    const assessor = toPermissionSet(["applications.read", "assessments.deliver", "assessments.score.write"]);
    expect(visibleViews(assessor, "assessment").map((v) => v.key)).toEqual(["today", "list"]);
    // No finance, no export: Enrolment opens on registrations.
    const staff = toPermissionSet(["applications.read", "applications.write", "offers.read"]);
    expect(visibleViews(staff, "enrolment").map((v) => v.key)).toEqual(["registrations", "list"]);
    expect(visibleViews(staff, "assessment").map((v) => v.key)).toEqual(["list"]);
    const admin = toPermissionSet(["admin"]);
    expect(visibleViews(admin, "enrolment").map((v) => v.key)).toEqual(["payments", "registrations", "export", "list"]);
  });

  it("keeps the menu item lit on every page a view opens", () => {
    for (const entry of ADMISSIONS_ENTRIES) {
      const path = entry.href.split("?")[0];
      expect(ADMISSIONS_PATHS.some((p) => path === p || path.startsWith(p + "/"))).toBe(true);
    }
  });
});
