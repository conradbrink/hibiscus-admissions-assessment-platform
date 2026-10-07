import { describe, expect, it } from "vitest";
import { activePreset, DEFAULT_PRESET, rangeFor, RANGE_PRESETS } from "./ranges";

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
