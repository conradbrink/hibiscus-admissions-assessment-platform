import { describe, expect, it } from "vitest";
import { backdropFor, MAX_NARRATION_CHARS, normaliseNarration, numberToWords, parseCount, parseFocus, pickVoice, RAIN_CHART, spokenNarration, strandStopped, tallyOutcome } from "./story";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("parseFocus", () => {
  it("splits a kind from its comma list", () => {
    expect(parseFocus("cards:1,3,5")).toEqual({ kind: "cards", args: ["1", "3", "5"], raw: "1,3,5", highlight: false });
  });
  it("keeps prose whole, colons and commas included", () => {
    const f = parseFocus("text:The market opens at nine o'clock. Farmers, too.");
    expect(f.args).toHaveLength(1);
    expect(f.raw).toBe("The market opens at nine o'clock. Farmers, too.");
    expect(parseFocus("clock:3:00")).toMatchObject({ kind: "clock", args: ["3:00"] });
    expect(parseFocus("sum:36+?=50")).toMatchObject({ kind: "sum", raw: "36+?=50" });
  });
  it("reads a highlight from either end", () => {
    expect(parseFocus("hat!")).toMatchObject({ kind: "hat", highlight: true, args: [] });
    expect(parseFocus("shapes:triangle!")).toMatchObject({ kind: "shapes", args: ["triangle"], highlight: true });
    expect(parseFocus("frames:tree!")).toMatchObject({ kind: "frames", args: ["tree"], highlight: true });
  });
});

describe("parseCount", () => {
  it("reads plain counts, sums, differences, arrays and heaps", () => {
    expect(parseCount("3")).toEqual({ shape: "count", n: 3 });
    expect(parseCount("2+1")).toEqual({ shape: "plus", a: 2, b: 1 });
    expect(parseCount("5-2")).toEqual({ shape: "minus", a: 5, b: 2 });
    expect(parseCount("3x5")).toEqual({ shape: "array", rows: 3, cols: 5, extra: 0 });
    expect(parseCount("4x9+6")).toEqual({ shape: "array", rows: 4, cols: 9, extra: 6 });
    expect(parseCount("many")).toEqual({ shape: "heap" });
    expect(parseCount(undefined)).toEqual({ shape: "count", n: 1 });
  });
  it("caps a count so a typo cannot draw a thousand apples", () => {
    expect(parseCount("999")).toEqual({ shape: "count", n: 60 });
  });
});

describe("backdropFor", () => {
  it("maps every seeded scene to a drawn world", () => {
    expect(backdropFor("river-wake")).toBe("river");
    expect(backdropFor("picnic")).toBe("river");
    expect(backdropFor("signpost")).toBe("path");
    expect(backdropFor("market")).toBe("market");
    expect(backdropFor("village-gate")).toBe("village");
    expect(backdropFor("clock-tower")).toBe("village");
    expect(backdropFor("letter")).toBe("letter");
    expect(backdropFor("rain-chart")).toBe("hill");
    expect(backdropFor("hill-home")).toBe("hill");
    expect(backdropFor("home")).toBe("home");
    expect(backdropFor(null)).toBe("river");
  });
});

describe("pickVoice", () => {
  it("prefers a warm British or Southern African English voice", () => {
    const voices = [
      { name: "Google Deutsch", lang: "de-DE" },
      { name: "Daniel", lang: "en-GB" },
      { name: "Microsoft Libby Online (Natural) - English (United Kingdom)", lang: "en-GB" },
      { name: "Samantha", lang: "en-US", default: true },
    ];
    expect(pickVoice(voices)?.name).toContain("Libby");
  });
  it("takes a South African voice over a British one", () => {
    const voices = [
      { name: "Microsoft Leah Online (Natural) - English (South Africa)", lang: "en-ZA" },
      { name: "Microsoft Sonia Online (Natural) - English (United Kingdom)", lang: "en-GB" },
    ];
    expect(pickVoice(voices)?.lang).toBe("en-ZA");
  });
  it("never picks a male voice while a female English voice exists, whatever the accent", () => {
    const voices = [
      { name: "Daniel", lang: "en-GB" },
      { name: "Google UK English Male", lang: "en-GB" },
      { name: "Samantha", lang: "en-US" },
    ];
    expect(pickVoice(voices)?.name).toBe("Samantha");
  });
  it("returns null when nothing speaks English", () => {
    expect(pickVoice([{ name: "Amélie", lang: "fr-CA" }])).toBeNull();
  });
});

describe("the stop rule", () => {
  it("stops a strand after three misses in a row and resets on a hit", () => {
    let t = tallyOutcome({}, "c", "incorrect");
    t = tallyOutcome(t, "c", "incorrect");
    expect(strandStopped(t, "c", 3)).toBe(false);
    t = tallyOutcome(t, "c", "partial");
    t = tallyOutcome(t, "c", "incorrect");
    t = tallyOutcome(t, "c", "incorrect");
    expect(strandStopped(t, "c", 3)).toBe(false);
    t = tallyOutcome(t, "c", "incorrect");
    expect(strandStopped(t, "c", 3)).toBe(true);
    expect(strandStopped(t, "other", 3)).toBe(false);
    expect(strandStopped(t, "c", null)).toBe(false);
  });
  it("ignores a skip", () => {
    const t = tallyOutcome({ c: 2 }, "c", "skipped");
    expect(t.c).toBe(2);
  });
});

describe("the rain chart", () => {
  it("agrees with the Stage 3 questions that read it", () => {
    const mm = Object.fromEntries(RAIN_CHART.map((r) => [r.month, r.mm]));
    const most = RAIN_CHART.reduce((a, b) => (b.mm > a.mm ? b : a));
    expect(most.month).toBe("Jan");
    expect(mm.Feb).toBe(80);
    expect(mm.Dec - mm.Mar).toBe(40);
    expect(mm.Feb + mm.Apr).toBe(100);
    expect(mm.Nov + mm.Mar).not.toBe(100);
    expect(mm.Dec + mm.Apr).not.toBe(100);
  });
});

describe("normaliseNarration", () => {
  it("collapses whitespace so two spellings share a recording, and caps the length", () => {
    expect(normaliseNarration("  Point to   the\napple. ")).toBe("Point to the apple.");
    expect(normaliseNarration("x".repeat(5000))).toHaveLength(MAX_NARRATION_CHARS);
  });
});

describe("numberToWords", () => {
  it("says a number the way a British teacher reads it aloud", () => {
    expect(numberToWords(0)).toBe("zero");
    expect(numberToWords(7)).toBe("seven");
    expect(numberToWords(13)).toBe("thirteen");
    expect(numberToWords(20)).toBe("twenty");
    expect(numberToWords(21)).toBe("twenty-one");
    expect(numberToWords(56)).toBe("fifty-six");
    expect(numberToWords(100)).toBe("one hundred");
    expect(numberToWords(110)).toBe("one hundred and ten");
    expect(numberToWords(642)).toBe("six hundred and forty-two");
    expect(numberToWords(703)).toBe("seven hundred and three");
    expect(numberToWords(999)).toBe("nine hundred and ninety-nine");
  });

  it("leaves anything it cannot say properly as digits", () => {
    // Better a spoken numeral than a confident wrong word.
    expect(numberToWords(10_000)).toBe("10000");
    expect(numberToWords(-1)).toBe("-1");
    expect(numberToWords(1.5)).toBe("1.5");
  });
});

describe("how maths is spoken", () => {
  it("turns an equation into a sentence", () => {
    expect(spokenNarration("3 × 7 = ?")).toBe("three times seven equals what?");
    expect(spokenNarration("? × 8 = 56")).toBe("what times eight equals fifty-six?");
    expect(spokenNarration("36 + ? = 50")).toBe("thirty-six plus what equals fifty?");
    expect(spokenNarration("24 ÷ 3 = ?")).toBe("twenty-four divided by three equals what?");
  });

  it("reads the Unicode minus, not only the keyboard one", () => {
    // The content uses U+2212. A rule written for "-" alone would leave the
    // one character that actually appears in the story untouched.
    expect(spokenNarration("703 − 458 = ?")).toBe("seven hundred and three minus four hundred and fifty-eight equals what?");
    expect(spokenNarration("703 - 458 = ?")).toBe("seven hundred and three minus four hundred and fifty-eight equals what?");
  });

  it("leaves prose exactly as it was", () => {
    // Not tidiness: the recording cache is keyed on this string, so any
    // change here silently throws away every sentence already recorded.
    for (const line of ["Point to the apple.", "Well done! You're a great helper.", "Which basket has more?"]) {
      expect(spokenNarration(line)).toBe(line);
    }
  });

  it("does not mistake an ordinary question mark for an unknown", () => {
    // "?" means "the missing number" only in an equation. Everywhere else it
    // is punctuation, and "= " is what tells the two apart.
    expect(spokenNarration("What is the value of the 6 in 642?")).toBe(
      "What is the value of the six in six hundred and forty-two?"
    );
    expect(spokenNarration("How many centimetres in 2 metres?")).toBe("How many centimetres in two metres?");
  });

  it("says units rather than spelling out the letter", () => {
    expect(spokenNarration("The path is 350 m, then 275 m.")).toBe(
      "The path is three hundred and fifty metres, then two hundred and seventy-five metres."
    );
    expect(spokenNarration("Which two months together had 100 mm?")).toBe(
      "Which two months together had one hundred millimetres?"
    );
  });

  it("does not treat a hyphen inside a word as a minus", () => {
    expect(spokenNarration("Tumi is a well-known helper.")).toBe("Tumi is a well-known helper.");
  });

  it("leaves no digit or symbol unspoken in any real story line", () => {
    // The bug, stated against the actual content rather than a fixture: read
    // every narration in every chapter, and assert that nothing reaches the
    // voice as a bare numeral or operator. The fourteen letterless maths
    // lines are the ones that were being read in another language, because
    // they gave the multilingual model no English to detect.
    const dir = join(process.cwd(), "content", "story");
    const narrations: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
      } else if (node && typeof node === "object") {
        const line = (node as { narration?: unknown }).narration;
        if (typeof line === "string" && line.trim()) narrations.push(line);
        for (const child of Object.values(node as Record<string, unknown>)) walk(child);
      }
    };
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      walk(JSON.parse(readFileSync(join(dir, file), "utf8")));
    }

    expect(narrations.length).toBeGreaterThan(100);
    const withDigits = narrations.filter((n) => /\d/.test(n));
    // If the chapters ever stop containing maths, this test is passing for
    // the wrong reason and should be deleted rather than left green.
    expect(withDigits.length).toBeGreaterThanOrEqual(45);

    const letterless = narrations.filter((n) => !/[A-Za-z]/.test(n));
    expect(letterless.length).toBeGreaterThanOrEqual(14);

    for (const line of narrations) {
      const spoken = spokenNarration(line);
      expect(spoken, `digits left in: ${line}`).not.toMatch(/\d/);
      expect(spoken, `operator left in: ${line}`).not.toMatch(/[+=×÷−]/);
      // Every line must now carry English for the model to detect.
      expect(spoken, `still no letters in: ${line}`).toMatch(/[A-Za-z]/);
    }
  });
});
