import { describe, expect, it } from "vitest";
import { backdropFor, parseCount, parseFocus, pickVoice, RAIN_CHART, strandStopped, tallyOutcome } from "./story";

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
