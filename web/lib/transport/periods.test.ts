import { describe, expect, it } from "vitest";
import { defaultTerm, periodOptions, ridingPeriodIds, termPeriodIds, type PeriodLike } from "@/lib/transport/periods";

const term = (id: string, starts: string, ends: string): PeriodLike => ({ id, kind: "term", term_period_id: null, month_index: null, label: id, starts_on: starts, ends_on: ends });
const month = (id: string, termId: string, i: number, starts: string, ends: string): PeriodLike => ({ id, kind: "month", term_period_id: termId, month_index: i, label: id, starts_on: starts, ends_on: ends });

const periods: PeriodLike[] = [
  month("t1m2", "t1", 2, "2027-02-01", "2027-02-28"),
  term("t1", "2027-01-11", "2027-04-09"),
  month("t1m1", "t1", 1, "2027-01-11", "2027-01-31"),
  term("t2", "2027-05-03", "2027-08-06"),
  month("t2m1", "t2", 1, "2027-05-03", "2027-05-31"),
];

describe("ridingPeriodIds", () => {
  it("a term takes its own bookings and every month's", () => {
    expect(ridingPeriodIds(periods, "t1").sort()).toEqual(["t1", "t1m1", "t1m2"]);
  });
  it("a month takes its own bookings and the term's, not the other months'", () => {
    expect(ridingPeriodIds(periods, "t1m2").sort()).toEqual(["t1", "t1m2"]);
  });
  it("an unknown period takes nothing", () => {
    expect(ridingPeriodIds(periods, "nope")).toEqual([]);
  });
});

describe("termPeriodIds", () => {
  it("is a term and its months, and nothing for a month", () => {
    expect(termPeriodIds(periods, "t2").sort()).toEqual(["t2", "t2m1"]);
    expect(termPeriodIds(periods, "t1m1")).toEqual([]);
  });
});

describe("defaultTerm", () => {
  it("is the term running today", () => {
    expect(defaultTerm(periods, "2027-02-15")?.id).toBe("t1");
  });
  it("is the next term between terms", () => {
    expect(defaultTerm(periods, "2027-04-20")?.id).toBe("t2");
    expect(defaultTerm(periods, "2026-10-18")?.id).toBe("t1");
  });
  it("is the latest term once all have ended, and nothing without terms", () => {
    expect(defaultTerm(periods, "2028-01-01")?.id).toBe("t2");
    expect(defaultTerm([], "2028-01-01")).toBeNull();
  });
});

describe("periodOptions", () => {
  it("lists each term, then its months in order", () => {
    expect(periodOptions(periods).map((p) => `${p.indent ? "  " : ""}${p.id}`)).toEqual(["t1", "  t1m1", "  t1m2", "t2", "  t2m1"]);
  });
});
