import { describe, expect, it } from "vitest";
import { computeProfile } from "@/lib/profile/compute";
import { buildEvidence, fallbackNarrative, marksWord, narrativeInput, outcomeWord, validateNarrative, type EvidenceRow } from "@/lib/profile/narrative";

const ENG = "11111111-1111-4111-8111-111111111111";
const MAT = "22222222-2222-4222-8222-222222222222";
const READ = "33333333-3333-4333-8333-333333333333";
const GRAM = "44444444-4444-4444-8444-444444444444";
const NUM = "55555555-5555-4555-8555-555555555555";
const HIDDEN = "66666666-6666-4666-8666-666666666666";

const subjects = [
  { id: ENG, name: "English", sortOrder: 1 },
  { id: MAT, name: "Mathematics", sortOrder: 2 },
];
const competencies = [
  { id: READ, name: "Reading", subjectId: ENG, focusLabel: "Reading fluency", reportable: true, sortOrder: 1 },
  { id: GRAM, name: "Grammar", subjectId: ENG, focusLabel: "Grammar", reportable: true, sortOrder: 2 },
  { id: NUM, name: "Number Sense", subjectId: MAT, focusLabel: "Number sense", reportable: true, sortOrder: 3 },
  { id: HIDDEN, name: "Internal check", subjectId: MAT, focusLabel: null, reportable: false, sortOrder: 4 },
];
const lines = [
  { scope: "overall" as const, scopeId: null, percent: 78, band: "meeting" as const },
  { scope: "subject" as const, scopeId: ENG, percent: 80, band: "exceeding" as const },
  { scope: "subject" as const, scopeId: MAT, percent: 72.5, band: "meeting" as const },
  { scope: "competency" as const, scopeId: READ, percent: 91, band: "exceeding" as const },
  { scope: "competency" as const, scopeId: GRAM, percent: 55, band: "approaching" as const },
  { scope: "competency" as const, scopeId: NUM, percent: 72.5, band: "meeting" as const },
  { scope: "competency" as const, scopeId: HIDDEN, percent: 10, band: "below" as const },
];

describe("computeProfile", () => {
  const p = computeProfile(lines, competencies, subjects);

  it("picks strengths and development areas from reportable competencies only", () => {
    expect(p.strengths.map((s) => s.name)).toEqual(["Reading", "Number Sense"]);
    expect(p.development.map((d) => d.name)).toEqual(["Grammar"]);
    expect(p.focus).toEqual(["Grammar"]);
    expect(p.competencies.find((c) => c.name === "Internal check")).toBeUndefined();
  });

  it("lists every number the narrative may use", () => {
    expect(p.allowedNumbers).toEqual([78, 80, 72.5, 91, 55, 72.5]);
  });
});

describe("validateNarrative", () => {
  const p = computeProfile(lines, competencies, subjects);
  const names = { firstName: "John", lastName: "Smith" };

  it("accepts the fallback narrative", () => {
    expect(validateNarrative(fallbackNarrative(p, "John"), p, names)).toEqual([]);
  });

  it("lets the grade applied for be named, since its digits are not a result", () => {
    const n = { summary: "John is applying for Form 1 and scored 78% overall.", strengths_text: "", development_text: "" };
    expect(validateNarrative(n, p, { ...names, gradeName: "Form 1" }).filter((x) => x.kind === "number")).toEqual([]);
    expect(validateNarrative({ ...n, summary: "John, entering Stage 7, scored 78% overall." }, p, names).filter((x) => x.kind === "number")).toEqual([]);
  });

  it("rejects a number that was not computed", () => {
    const n = { summary: "John scored 78% overall and 79% in English, a strong result.", strengths_text: "", development_text: "" };
    expect(validateNarrative(n, p, names).map((x) => x.kind)).toContain("number");
  });

  it("rejects diagnostic, evaluative and admission language", () => {
    for (const bad of ["John may have dyslexia.", "John is gifted.", "John has trouble with concentration.", "John's IQ is high.", "We are pleased to offer John a place."]) {
      const n = { summary: `${bad} His result was 78%.`, strengths_text: "", development_text: "" };
      expect(validateNarrative(n, p, names).map((x) => x.kind), bad).toContain("term");
    }
  });

  it("rejects the surname", () => {
    const n = { summary: "John Smith scored 78% overall in the assessment.", strengths_text: "", development_text: "" };
    expect(validateNarrative(n, p, names).map((x) => x.kind)).toContain("name");
  });
});

describe("validateNarrative pronouns", () => {
  const p = computeProfile(lines, competencies, subjects);
  it("refuses a guessed gender and accepts the name or they", () => {
    const base = { strengths_text: "", development_text: "" };
    expect(validateNarrative({ ...base, summary: "John did well and his reading was strong." }, p, { firstName: "John", lastName: "Smith" }).map((x) => x.kind)).toContain("pronoun");
    expect(validateNarrative({ ...base, summary: "John did well and their reading was strong." }, p, { firstName: "John", lastName: "Smith" }).filter((x) => x.kind === "pronoun")).toEqual([]);
  });
});

describe("buildEvidence", () => {
  const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
    skill: "Arithmetic", type: "single_choice", task: "Add.", isCorrect: true, marksAwarded: 1, marksAvailable: 1, bandLabel: null, note: null, ...over,
  });
  it("turns objective marks into words per skill and never counts", () => {
    const e = buildEvidence([row({}), row({}), row({ isCorrect: false }), row({ skill: "Reading", isCorrect: true }), row({ skill: "Geometry", isCorrect: null })]);
    expect(e.objective).toEqual([{ skill: "Arithmetic", outcome: "most correct" }, { skill: "Reading", outcome: "all correct" }]);
    expect(JSON.stringify(e)).not.toMatch(/\d/);
  });
  it("keeps the marker's note without its digits", () => {
    const e = buildEvidence([row({ type: "extended_text", skill: "Written Language", marksAwarded: 16, marksAvailable: 20, bandLabel: "Strong", note: "Gives 6 1/2 and 2 × 2 × 3 correctly." })]);
    expect(e.written[0].result).toBe("Strong");
    expect(e.written[0].note).toBe("Gives [number] [number] and [number] × [number] × [number] correctly.");
  });
  it("describes a rubric mark in words when no band is known", () => {
    expect(marksWord(20, 20)).toBe("full marks");
    expect(marksWord(16, 20)).toBe("most of the marks");
    expect(marksWord(0, 20)).toBe("no marks");
    expect(outcomeWord(2, 5)).toBe("about half correct");
  });
});

describe("narrativeInput", () => {
  it("shows the model no digits from the evidence and names a rejected attempt's problems", () => {
    const e = buildEvidence([{ skill: "Patterns", type: "extended_text", task: "Next 2 terms: 4, 7, 10, 13", isCorrect: null, marksAwarded: 2, marksAvailable: 2, bandLabel: null, note: "Gives 16 and 19." }]);
    const input = narrativeInput(computeProfile(lines, competencies, subjects), "John", "Form 1", e, [{ kind: "number", detail: "2013" }]);
    expect(input).not.toMatch(/\b(4|7|10|13|16|19)\b/);
    expect(input).toContain("the number 2013");
  });
});
