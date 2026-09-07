import { describe, expect, it } from "vitest";
import { lowestBand, marksForBand, markWithoutModel } from "@/lib/assessment/ai-marking";

const bands = [
  { key: "b2", label: "Full marks", min_marks: 2, descriptor: "Both points." },
  { key: "b0", label: "No credit", min_marks: 0, descriptor: "Nothing." },
  { key: "b1", label: "One mark", min_marks: 1, descriptor: "One point." },
];

describe("lowestBand", () => {
  it("finds the zero band whatever the order", () => {
    expect(lowestBand(bands).key).toBe("b0");
  });
});

describe("marksForBand", () => {
  it("awards the band's marks, capped at the question's", () => {
    expect(marksForBand(bands, "b1", 2)).toBe(1);
    expect(marksForBand(bands, "b2", 1)).toBe(1);
  });
  it("returns null for a band the rubric does not have", () => {
    expect(marksForBand(bands, "b9", 2)).toBeNull();
  });
});

describe("markWithoutModel", () => {
  it("gives a blank answer the lowest band with a reason", () => {
    expect(markWithoutModel("", bands)).toEqual({ band: "b0", rationale: "No answer was written." });
    expect(markWithoutModel("   ", bands)?.band).toBe("b0");
    expect(markWithoutModel(undefined, bands)?.band).toBe("b0");
  });
  it("leaves anything written, however short, for the model", () => {
    expect(markWithoutModel("6 1/2", bands)).toBeNull();
    expect(markWithoutModel("yes", bands)).toBeNull();
    expect(markWithoutModel("The skylark was singing high above the house.", bands)).toBeNull();
  });
});
