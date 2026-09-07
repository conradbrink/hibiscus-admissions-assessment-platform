import { describe, expect, it } from "vitest";
import { conditionsText, OFFER_CONDITIONS, offeredGradeId, parseConditionSelection } from "@/lib/offers/conditions";

const ctx = { childFirstName: "Naledi", appliedGradeName: "Stage 5", gradeName: (id: string) => (id === "g4" ? "Stage 4" : null) };

describe("offer conditions", () => {
  it("reads the form and writes numbered plain-English sentences", () => {
    const sel = parseConditionSelection({ cond_facilitator: "1", cond_lower_stage: "1", detail_lower_stage: "g4", cond_tutoring: "1", detail_tutoring: "Mathematics", conditionsOther: "  Bring the immunisation card. " });
    expect(sel.keys).toEqual(["facilitator", "lower_stage", "tutoring"]);
    expect(offeredGradeId(sel)).toBe("g4");
    const text = conditionsText(sel, ctx)!;
    expect(text.startsWith("(1) Naledi will need the support of a learning facilitator")).toBe(true);
    expect(text).toContain("(2) The place is offered in Stage 4 rather than Stage 5.");
    expect(text).toContain("(3) Naledi will need extra tutoring outside school in Mathematics.");
    expect(text).toContain("(4) Bring the immunisation card.");
  });
  it("is a single sentence without numbering when one condition applies, and null when none", () => {
    expect(conditionsText(parseConditionSelection({ cond_probation: "on" }), ctx)).toMatch(/^The place is offered on a probationary basis/);
    expect(conditionsText(parseConditionSelection({}), ctx)).toBeNull();
    // A condition that needs a detail is skipped without one.
    expect(conditionsText(parseConditionSelection({ cond_lower_stage: "1" }), ctx)).toBeNull();
    expect(conditionsText(parseConditionSelection({ cond_tutoring: "1" }), ctx)).toContain("outside school.");
  });
  it("keeps the old free-text field working", () => {
    expect(conditionsText(parseConditionSelection({ conditions: "Sibling discount applies." }), ctx)).toBe("Sibling discount applies.");
  });
  it("every condition has a key, a label and parent-facing text without leftover placeholders", () => {
    for (const c of OFFER_CONDITIONS) {
      expect(c.key).toMatch(/^[a-z_]+$/);
      expect(c.label.length).toBeGreaterThan(3);
      const t = conditionsText({ keys: [c.key], details: { [c.key]: c.detail === "grade" ? "g4" : "reading" }, other: null }, ctx)!;
      expect(t).not.toMatch(/\{[a-z_]+\}/);
    }
  });
});
