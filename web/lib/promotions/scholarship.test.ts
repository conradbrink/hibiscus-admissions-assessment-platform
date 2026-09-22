import { describe, expect, it } from "vitest";
import { awardLabelOf, awardPercentOf, isScholarshipCode } from "@/lib/promotions/scholarship";

describe("reading an award out of a promotion code", () => {
  it("reads the four bands the school awarded", () => {
    expect(awardPercentOf("SCHOLARSHIP-50")).toBe(50);
    expect(awardPercentOf("SCHOLARSHIP-40")).toBe(40);
    expect(awardPercentOf("SCHOLARSHIP-30")).toBe(30);
    expect(awardPercentOf("SCHOLARSHIP-20")).toBe(20);
  });

  it("says how it reads to a parent", () => {
    expect(awardLabelOf("SCHOLARSHIP-50")).toBe("50%");
    expect(awardLabelOf("SCHOLARSHIP-5")).toBe("5%");
  });

  it("does not treat every other deal as a scholarship", () => {
    // The promotions table is shared with ordinary marketing deals, and one
    // of those must never make a letter announce a scholarship.
    expect(isScholarshipCode("LAUNCH2027")).toBe(false);
    expect(isScholarshipCode("SIBLING-10")).toBe(false);
    expect(isScholarshipCode(null)).toBe(false);
    expect(isScholarshipCode(undefined)).toBe(false);
    expect(isScholarshipCode("")).toBe(false);
  });

  it("refuses a code that merely looks like one", () => {
    // A deal genuinely called SCHOLARSHIP-LAUNCH is a badly named promotion,
    // not a 0% award, and a letter must not offer "0% of school fees".
    expect(awardPercentOf("SCHOLARSHIP-LAUNCH")).toBeNull();
    expect(isScholarshipCode("SCHOLARSHIP-LAUNCH")).toBe(false);
    expect(awardPercentOf("SCHOLARSHIP-")).toBeNull();
    expect(awardPercentOf("SCHOLARSHIP-0")).toBeNull();
    expect(awardPercentOf("SCHOLARSHIP-101")).toBeNull();
    expect(awardLabelOf("SCHOLARSHIP-0")).toBeNull();
  });

  it("is case and prefix exact", () => {
    // Codes are uppercase by constraint; a lowercase one is a different row
    // and should not be guessed at.
    expect(isScholarshipCode("scholarship-50")).toBe(false);
    expect(isScholarshipCode("HIBISCUS-SCHOLARSHIP-50")).toBe(false);
  });

  it("accepts a full award", () => {
    expect(awardPercentOf("SCHOLARSHIP-100")).toBe(100);
    expect(awardLabelOf("SCHOLARSHIP-100")).toBe("100%");
  });
});
