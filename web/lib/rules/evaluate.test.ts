import { describe, expect, it } from "vitest";
import { evaluateAdmission, type Rule } from "@/lib/rules/evaluate";

const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const rules: Rule[] = [
  { scope: "overall", scopeId: null, operator: ">=", threshold: 50, severity: "hard_fail", label: "Overall at least 50%" },
  { scope: "subject", scopeId: S, operator: ">=", threshold: 40, severity: "review", label: "English at least 40%" },
  { scope: "competency", scopeId: C, operator: ">=", threshold: 30, severity: "review", label: "Reading at least 30%" },
];

const scores = (overall: number, english: number, reading: number) => [
  { scope: "overall" as const, scopeId: null, percent: overall },
  { scope: "subject" as const, scopeId: S, percent: english },
  { scope: "competency" as const, scopeId: C, percent: reading },
];

describe("evaluateAdmission", () => {
  it("no ruleset → staff review, never approved or declined", () => {
    const e = evaluateAdmission({ scores: scores(95, 95, 95), rules: null, placesRemaining: 10 });
    expect(e.outcome).toBe("staff_review");
  });

  it("hard fail wins over review", () => {
    const e = evaluateAdmission({ scores: scores(45, 30, 20), rules, placesRemaining: 10 });
    expect(e.outcome).toBe("declined");
    expect(e.reason).toContain("Overall");
  });

  it("a review failure routes to a person", () => {
    const e = evaluateAdmission({ scores: scores(70, 35, 50), rules, placesRemaining: 10 });
    expect(e.outcome).toBe("staff_review");
    expect(e.results.find((r) => r.rule.scope === "subject")?.effect).toBe("review");
  });

  it("all pass with places → approved; without places → waitlisted; unlimited → approved", () => {
    expect(evaluateAdmission({ scores: scores(70, 60, 50), rules, placesRemaining: 3 }).outcome).toBe("approved");
    expect(evaluateAdmission({ scores: scores(70, 60, 50), rules, placesRemaining: 0 }).outcome).toBe("waitlisted");
    expect(evaluateAdmission({ scores: scores(70, 60, 50), rules, placesRemaining: null }).outcome).toBe("approved");
  });

  it("a rule with no matching score is unverifiable and means review", () => {
    const e = evaluateAdmission({ scores: scores(70, 60, 50).slice(0, 2), rules, placesRemaining: 5 });
    expect(e.outcome).toBe("staff_review");
    expect(e.results.find((r) => r.rule.scope === "competency")?.effect).toBe("unverifiable");
  });

  it("boundaries: >= passes at the threshold, > does not", () => {
    const eq: Rule[] = [{ scope: "overall", scopeId: null, operator: ">=", threshold: 50, severity: "hard_fail", label: "x" }];
    const gt: Rule[] = [{ scope: "overall", scopeId: null, operator: ">", threshold: 50, severity: "hard_fail", label: "x" }];
    expect(evaluateAdmission({ scores: scores(50, 0, 0), rules: eq, placesRemaining: null }).outcome).toBe("approved");
    expect(evaluateAdmission({ scores: scores(50, 0, 0), rules: gt, placesRemaining: null }).outcome).toBe("declined");
  });
});
