import { describe, expect, it } from "vitest";
import { cleanBehaviour, judgeAnswer, summariseIntegrity } from "@/lib/integrity/signals";

const long = "I would speak to the child calmly and make sure they feel safe. ".repeat(6); // ~390 chars

describe("judgeAnswer", () => {
  it("passes an answer that was typed at a human pace and the model calls low", () => {
    const v = judgeAnswer({
      text: long,
      behaviour: { activeMs: 5 * 60_000, keystrokes: 420, pastedChars: 0, pasteEvents: 0 },
      model: "low",
      duplicateSimilarity: null,
    });
    expect(v.level).toBe("low");
    expect(v.reasons).toEqual([]);
  });

  it("flags a long answer pasted in one go", () => {
    const v = judgeAnswer({
      text: long,
      behaviour: { activeMs: 4000, keystrokes: 2, pastedChars: long.length, pasteEvents: 1 },
      model: "low",
      duplicateSimilarity: null,
    });
    expect(v.level).toBe("medium");
    expect(v.reasons).toContain("mostly_pasted");
    expect(v.reasons).toContain("pasted_in_one_go");
  });

  it("calls it high when pasting and the model agree", () => {
    const v = judgeAnswer({
      text: long,
      behaviour: { pastedChars: long.length, pasteEvents: 1 },
      model: "medium",
      duplicateSimilarity: null,
    });
    expect(v.level).toBe("high");
  });

  it("calls a near-copy of another applicant high on its own", () => {
    const v = judgeAnswer({ text: long, behaviour: {}, model: "low", duplicateSimilarity: 0.91 });
    expect(v.level).toBe("high");
    expect(v.reasons).toContain("duplicate");
  });

  it("notices typing faster than a person can", () => {
    const v = judgeAnswer({
      text: long,
      behaviour: { activeMs: 10_000, keystrokes: long.length, pastedChars: 0 },
      model: "low",
      duplicateSimilarity: null,
    });
    expect(v.reasons).toContain("implausibly_fast");
    expect(v.level).toBe("medium");
  });

  it("does not judge a short answer on how it was written", () => {
    const v = judgeAnswer({ text: "Yes, I would.", behaviour: { pastedChars: 13, pasteEvents: 1 }, model: null, duplicateSimilarity: null });
    expect(v.level).toBe("low");
  });

  it("says unchecked, not clean, before the model has run", () => {
    const v = judgeAnswer({ text: long, behaviour: { activeMs: 5 * 60_000, keystrokes: 400 }, model: null, duplicateSimilarity: null });
    expect(v.level).toBe("unchecked");
  });
});

describe("cleanBehaviour", () => {
  it("turns whatever the browser sent into safe numbers", () => {
    expect(cleanBehaviour({ activeMs: -5, keystrokes: "lots", pastedChars: Infinity })).toEqual({
      activeMs: 0,
      keystrokes: 0,
      pastedChars: 0,
      pasteEvents: 0,
      blurCount: 0,
    });
    expect(cleanBehaviour(null).activeMs).toBe(0);
  });
});

describe("summariseIntegrity", () => {
  it("counts flagged answers", () => {
    const s = summariseIntegrity([
      { level: "high", reasons: [], pastedShare: 1 },
      { level: "medium", reasons: [], pastedShare: 0.7 },
      { level: "low", reasons: [], pastedShare: 0 },
      { level: "unchecked", reasons: [], pastedShare: 0 },
    ]);
    expect(s).toEqual({ flagged: 2, high: 1, unchecked: 1, total: 4 });
  });
});
