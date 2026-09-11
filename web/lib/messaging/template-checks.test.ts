import { describe, expect, it } from "vitest";
import { templateProblems } from "@/lib/messaging/template-checks";

/**
 * These ran only in the browser until the save path broke on them: the
 * function was exported from a `"use client"` module, so the server action's
 * import resolved to a client reference and pressing Save threw instead of
 * validating. Living in `lib/` is what makes it both callable from the server
 * and testable here.
 */

const base = {
  parameters: ["parent_first_name"],
  bodyPreview: "Hi {{1}}.",
  allowed: ["parent_first_name", "student_first_name"],
  active: false,
};

describe("templateProblems", () => {
  it("passes a matching wording and variable list", () => {
    expect(templateProblems(base)).toEqual([]);
  });

  it("counts placeholders against the variables listed", () => {
    const problems = templateProblems({ ...base, bodyPreview: "Hi {{1}}, about {{2}}." });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("2 placeholder(s) but 1 variable(s)");
  });

  it("refuses a variable the email does not allow", () => {
    const problems = templateProblems({ ...base, parameters: ["campus"], allowed: ["parent_first_name"] });
    expect(problems[0]).toContain("Not an allowed variable");
  });

  it("keeps links off the body", () => {
    const problems = templateProblems({ ...base, parameters: ["offer_link"], allowed: ["offer_link"] });
    expect(problems.some((p) => p.includes("Links go on the button"))).toBe(true);
  });

  it("wants the Zavu id before a template goes active", () => {
    expect(templateProblems({ ...base, active: true })).toEqual(["An active template needs its Zavu template id"]);
  });

  it("is satisfied by a Zavu id", () => {
    expect(templateProblems({ ...base, active: true, zavuTemplateId: "tpl_abc123" })).toEqual([]);
  });

  it("takes the Zavu id in whatever shape Zavu issues it", () => {
    // Zavu does not document a fixed format the way Twilio's HX SIDs are, so
    // guessing one here would refuse ids that work.
    for (const id of ["tpl_abc123", "01JAV7Q0X9", "booking-confirmed/v2"]) {
      expect(templateProblems({ ...base, active: true, zavuTemplateId: id })).toEqual([]);
    }
  });

  it("ignores whitespace passed as an id", () => {
    expect(templateProblems({ ...base, active: true, zavuTemplateId: "   " })).toEqual([
      "An active template needs its Zavu template id",
    ]);
  });

  it("lets an inactive template rest without an id", () => {
    expect(templateProblems({ ...base, active: false })).toEqual([]);
  });
});
