import { describe, expect, it } from "vitest";
import { activePreset, DEFAULT_PRESET, isCalendarDate, rangeFor, RANGE_PRESETS, resolveRange } from "./ranges";

const today = new Date("2026-10-07T09:00:00+02:00");

describe("range presets", () => {
  it("ends every window today", () => {
    for (const p of RANGE_PRESETS) expect(rangeFor(p, today).to).toBe("2026-10-07");
  });

  it("counts back the days it says", () => {
    expect(rangeFor(RANGE_PRESETS[0], today).from).toBe("2026-09-30");
    expect(rangeFor(RANGE_PRESETS[1], today).from).toBe("2026-09-07");
    expect(rangeFor(RANGE_PRESETS[2], today).from).toBe("2026-07-09");
  });

  it("recognises its own ranges, and nothing else", () => {
    const ninety = rangeFor(RANGE_PRESETS[2], today);
    expect(activePreset(ninety.from, ninety.to, today)).toBe("90d");
    expect(activePreset("2026-09-01", "2026-10-07", today)).toBeNull();
  });

  it("offers a default that is one of the presets", () => {
    expect(RANGE_PRESETS.map((p) => p.key)).toContain(DEFAULT_PRESET);
  });
});

describe("the range the URL asks for", () => {
  const fallback = rangeFor(RANGE_PRESETS.find((p) => p.key === DEFAULT_PRESET)!, today);

  it("takes real dates as given", () => {
    expect(resolveRange("2026-01-01", "2026-03-31", today)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("falls back for a date that is not a day", () => {
    // 2026-13-01 once reached previousRange and threw.
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(resolveRange("2026-13-01", "2026-02-31", today)).toEqual(fallback);
    expect(resolveRange(undefined, null, today)).toEqual(fallback);
  });

  it("refuses years no intake is in, which would draw years of weeks", () => {
    // 9999 spun the weekly series for 14 million weeks; 0202 is a slip for 2026.
    expect(isCalendarDate("9999-12-31")).toBe(false);
    expect(isCalendarDate("0202-10-13")).toBe(false);
    expect(resolveRange("2026-07-01", "9999-12-31", today)).toEqual({ from: "2026-07-01", to: fallback.to });
  });

  it("turns a backwards range round rather than reading it as empty", () => {
    expect(resolveRange("2026-10-13", "2026-07-15", today)).toEqual({ from: "2026-07-15", to: "2026-10-13" });
  });

  it("falls back for a range longer than ten years", () => {
    expect(resolveRange("2001-01-01", "2026-10-07", today)).toEqual(fallback);
    expect(resolveRange("2016-10-08", "2026-10-07", today)).toEqual({ from: "2016-10-08", to: "2026-10-07" });
  });
});
