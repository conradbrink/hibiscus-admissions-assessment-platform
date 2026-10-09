import { describe, expect, it } from "vitest";
import { employedDuring, periodBounds, periodLabel, shiftPeriod } from "@/lib/payroll/period";

describe("pay months", () => {
  it("knows the last day of each month, leap years included", () => {
    expect(periodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodBounds("2028-02").end).toBe("2028-02-29");
    expect(periodBounds("2026-12").end).toBe("2026-12-31");
  });

  it("refuses something that is not a month", () => {
    expect(() => periodBounds("2026-13")).toThrow();
    expect(() => periodBounds("2026-1")).toThrow();
  });

  it("names and moves months across a year end", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });

  it("counts someone who started or left mid-month as employed", () => {
    expect(employedDuring({ start_date: "2026-10-15", end_date: null }, "2026-10")).toBe(true);
    expect(employedDuring({ start_date: "2026-01-01", end_date: "2026-10-01" }, "2026-10")).toBe(true);
    expect(employedDuring({ start_date: "2026-11-01", end_date: null }, "2026-10")).toBe(false);
    expect(employedDuring({ start_date: "2026-01-01", end_date: "2026-09-30" }, "2026-10")).toBe(false);
  });
});
