import { describe, expect, it } from "vitest";
import { markResponse, normaliseText } from "@/lib/assessment/marking";
import { parseAnswerKey } from "@/lib/assessment/keys";
import { computeScores, selectBenchmark } from "@/lib/assessment/scoring";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

describe("parseAnswerKey", () => {
  it("accepts each type's shape and rejects the wrong one", () => {
    expect(parseAnswerKey("single_choice", { option_ids: [A] })?.type).toBe("single_choice");
    expect(parseAnswerKey("single_choice", { option_ids: [A, B] })).toBeNull();
    expect(parseAnswerKey("numeric", { value: 3, tolerance: 0.5 })?.type).toBe("numeric");
    expect(parseAnswerKey("numeric", { value: "3" })).toBeNull();
    expect(parseAnswerKey("short_text", { accepted: [] })).toBeNull();
    expect(parseAnswerKey("extended_text", { accepted: ["x"] })).toBeNull();
  });
});

describe("markResponse", () => {
  it("single choice: the one option", () => {
    const key = parseAnswerKey("single_choice", { option_ids: [A] });
    expect(markResponse("single_choice", key, { option_id: A }, 2, false)).toEqual({ status: "marked", isCorrect: true, marksAwarded: 2 });
    expect(markResponse("single_choice", key, { option_id: B }, 2, false)).toEqual({ status: "marked", isCorrect: false, marksAwarded: 0 });
    expect(markResponse("single_choice", key, null, 2, false)).toEqual({ status: "marked", isCorrect: false, marksAwarded: 0 });
  });

  it("multi select: all-or-nothing by default, per option with partial credit", () => {
    const key = parseAnswerKey("multi_select", { option_ids: [A, B] });
    expect(markResponse("multi_select", key, { option_ids: [B, A] }, 4, false).status === "marked" && true).toBe(true);
    expect(markResponse("multi_select", key, { option_ids: [A] }, 4, false)).toMatchObject({ isCorrect: false, marksAwarded: 0 });
    expect(markResponse("multi_select", key, { option_ids: [A] }, 4, true)).toMatchObject({ isCorrect: false, marksAwarded: 2 });
    // A wrong tick cancels a right one, never below zero.
    expect(markResponse("multi_select", key, { option_ids: [A, C] }, 4, true)).toMatchObject({ marksAwarded: 0 });
    expect(markResponse("multi_select", key, { option_ids: [C, D] }, 4, true)).toMatchObject({ marksAwarded: 0 });
  });

  it("numeric: tolerance, typed strings, decimal commas, nonsense", () => {
    const key = parseAnswerKey("numeric", { value: 12.5, tolerance: 0.1 });
    expect(markResponse("numeric", key, { value: 12.55 }, 1, false)).toMatchObject({ isCorrect: true });
    expect(markResponse("numeric", key, { value: "12,5" }, 1, false)).toMatchObject({ isCorrect: true });
    expect(markResponse("numeric", key, { value: 12.7 }, 1, false)).toMatchObject({ isCorrect: false });
    expect(markResponse("numeric", key, { value: "twelve" }, 1, false)).toMatchObject({ isCorrect: false, marksAwarded: 0 });
  });

  it("short text: normalised comparison", () => {
    expect(normaliseText("  Twelve. ")).toBe("twelve");
    expect(normaliseText("a   BIG   dog!")).toBe("a big dog");
    const key = parseAnswerKey("short_text", { accepted: ["twelve", "12"] });
    expect(markResponse("short_text", key, { text: " TWELVE. " }, 1, false)).toMatchObject({ isCorrect: true });
    expect(markResponse("short_text", key, { text: "13" }, 1, false)).toMatchObject({ isCorrect: false });
    expect(markResponse("short_text", key, { text: "" }, 1, false)).toMatchObject({ isCorrect: false });
  });

  it("matching: per pair when partial", () => {
    const key = parseAnswerKey("matching", { pairs: [[A, C], [B, D]] });
    expect(markResponse("matching", key, { pairs: [[A, C], [B, D]] }, 2, false)).toMatchObject({ isCorrect: true, marksAwarded: 2 });
    expect(markResponse("matching", key, { pairs: [[A, C], [B, C]] }, 2, false)).toMatchObject({ isCorrect: false, marksAwarded: 0 });
    expect(markResponse("matching", key, { pairs: [[A, C], [B, C]] }, 2, true)).toMatchObject({ isCorrect: false, marksAwarded: 1 });
  });

  it("ordering: exact, or per position when partial", () => {
    const key = parseAnswerKey("ordering", { order: [A, B, C] });
    expect(markResponse("ordering", key, { order: [A, B, C] }, 3, false)).toMatchObject({ isCorrect: true, marksAwarded: 3 });
    expect(markResponse("ordering", key, { order: [A, C, B] }, 3, false)).toMatchObject({ marksAwarded: 0 });
    expect(markResponse("ordering", key, { order: [A, C, B] }, 3, true)).toMatchObject({ marksAwarded: 1 });
    expect(markResponse("ordering", key, { order: [A, B] }, 3, false)).toMatchObject({ isCorrect: false });
  });

  it("extended text needs a rubric; a missing key is unmarkable, not wrong", () => {
    expect(markResponse("extended_text", null, { text: "…" }, 10, false)).toEqual({ status: "needs_rubric" });
    expect(markResponse("numeric", null, { value: 1 }, 1, false).status).toBe("unmarkable");
    expect(markResponse("numeric", parseAnswerKey("short_text", { accepted: ["x"] }), { value: 1 }, 1, false).status).toBe("unmarkable");
  });
});

describe("computeScores", () => {
  const rules = [
    { scope: "overall" as const, scopeId: null, gradeSortMin: null, gradeSortMax: null, bands: [{ key: "below" as const, min_percent: 0 }, { key: "approaching" as const, min_percent: 40 }, { key: "meeting" as const, min_percent: 60 }, { key: "exceeding" as const, min_percent: 80 }] },
    { scope: "competency" as const, scopeId: A, gradeSortMin: 60, gradeSortMax: 110, bands: [{ key: "below" as const, min_percent: 0 }, { key: "meeting" as const, min_percent: 50 }] },
  ];

  it("aggregates by competency, subject and overall, banded", () => {
    const s = computeScores(
      [
        { competencyId: A, subjectId: C, marks: 2, marksAwarded: 2 },
        { competencyId: A, subjectId: C, marks: 2, marksAwarded: 0 },
        { competencyId: B, subjectId: D, marks: 4, marksAwarded: 4 },
      ],
      rules,
      90
    );
    expect(s.complete).toBe(true);
    const overall = s.lines.find((l) => l.scope === "overall")!;
    expect(overall).toMatchObject({ raw: 6, max: 8, percent: 75, band: "meeting" });
    // Competency A uses its own grade-banded benchmark: 50% is "meeting" there.
    expect(s.lines.find((l) => l.scope === "competency" && l.scopeId === A)).toMatchObject({ percent: 50, band: "meeting" });
    expect(s.lines.find((l) => l.scope === "subject" && l.scopeId === D)).toMatchObject({ percent: 100, band: "exceeding" });
  });

  it("is provisional while a rubric mark is outstanding", () => {
    const s = computeScores(
      [
        { competencyId: A, subjectId: C, marks: 2, marksAwarded: 2 },
        { competencyId: B, subjectId: C, marks: 10, marksAwarded: null },
      ],
      rules,
      90
    );
    expect(s.complete).toBe(false);
    expect(s.lines.find((l) => l.scope === "overall")).toMatchObject({ raw: 2, max: 12 });
  });

  it("selects the most specific benchmark, and only inside its grade band", () => {
    expect(selectBenchmark(rules, "competency", A, 90).length).toBe(2);
    expect(selectBenchmark(rules, "competency", A, 150).length).toBe(4);
    expect(selectBenchmark(rules, "subject", B, 90).length).toBe(4);
  });
});
