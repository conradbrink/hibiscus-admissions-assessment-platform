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
  metaName: "",
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

  it("wants an id from some provider before a template goes active", () => {
    const problems = templateProblems({ ...base, active: true });
    expect(problems).toEqual(["An active template needs an id from whichever provider is sending: Zavu, Twilio or Meta"]);
  });

  it("accepts a Zavu id alone as that identifier", () => {
    expect(templateProblems({ ...base, active: true, zavuTemplateId: "tpl_abc123" })).toEqual([]);
  });

  it("checks the shape of a Twilio SID but not of a Zavu id", () => {
    expect(templateProblems({ ...base, active: true, twilioContentSid: "nonsense" })).toEqual([
      "A Twilio content SID starts HX and has thirty-two more characters",
    ]);
    expect(templateProblems({ ...base, active: true, twilioContentSid: `HX${"a".repeat(32)}` })).toEqual([]);
  });

  it("checks the shape of a Meta template name", () => {
    const problems = templateProblems({ ...base, active: true, metaName: "Booking Confirmed" });
    expect(problems[0]).toContain("lower-case letters, digits and underscores");
  });
});
