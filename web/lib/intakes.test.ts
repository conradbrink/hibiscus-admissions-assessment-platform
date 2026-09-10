import { describe, expect, it } from "vitest";
import { offerableIntakes } from "@/lib/intakes";

/** The school's real 2026 and 2027 calendar, which is where the bug was found. */
const YEAR_2026 = "2026-12-04";
const YEAR_2027 = "2027-12-03";

const t1_2026 = { code: "t1-2026", starts_on: "2026-01-12", is_open: false, year_ends_on: YEAR_2026 };
const t2_2026 = { code: "t2-2026", starts_on: "2026-05-04", is_open: false, year_ends_on: YEAR_2026 };
const t3_2026 = { code: "t3-2026", starts_on: "2026-09-07", is_open: true, year_ends_on: YEAR_2026 };
const t1_2027 = { code: "t1-2027", starts_on: "2027-01-11", is_open: true, year_ends_on: YEAR_2027 };
const t2_2027 = { code: "t2-2027", starts_on: "2027-05-03", is_open: true, year_ends_on: YEAR_2027 };

const ALL = [t1_2026, t2_2026, t3_2026, t1_2027, t2_2027];
const codes = (today: string) => offerableIntakes(ALL, today).map((i) => i.code);

describe("offerableIntakes", () => {
  it("offers the term that has already started — the bug this fixes", () => {
    // 10 September 2026: Term 3 began three days ago and the school has it
    // open. Before this rule the earliest option was January.
    expect(codes("2026-09-10")).toEqual(["t3-2026", "t1-2027", "t2-2027"]);
  });

  it("offers a term on the day it starts", () => {
    expect(codes("2026-09-07")).toEqual(["t3-2026", "t1-2027", "t2-2027"]);
  });

  it("offers only what is ahead before the term begins", () => {
    expect(codes("2026-08-01")).toEqual(["t3-2026", "t1-2027", "t2-2027"]);
  });

  it("stops offering a term once its academic year has ended", () => {
    // 10 December: Term 3 finished on the 4th. Nothing is running, so the
    // next thing a family can join is January.
    expect(codes("2026-12-10")).toEqual(["t1-2027", "t2-2027"]);
  });

  it("still offers the running term on the last day of the year", () => {
    expect(codes("2026-12-04")).toEqual(["t3-2026", "t1-2027", "t2-2027"]);
  });

  it("does not offer an earlier term of the same year that has been overtaken", () => {
    // Term 1 reopened by mistake in September. You cannot join Term 1 now,
    // and only the running term is offered from the past.
    const reopened = ALL.map((i) => (i.code === "t1-2026" ? { ...i, is_open: true } : i));
    expect(offerableIntakes(reopened, "2026-09-10").map((i) => i.code)).toEqual([
      "t3-2026",
      "t1-2027",
      "t2-2027",
    ]);
  });

  it("never offers a term the school has closed", () => {
    const closed = ALL.map((i) => (i.code === "t3-2026" ? { ...i, is_open: false } : i));
    expect(offerableIntakes(closed, "2026-09-10").map((i) => i.code)).toEqual(["t1-2027", "t2-2027"]);
  });

  it("does not offer a started term whose year end is unknown", () => {
    const undated = [{ code: "x", starts_on: "2026-09-07", is_open: true, year_ends_on: null }];
    expect(offerableIntakes(undated, "2026-09-10")).toEqual([]);
    // Ahead of its start it is still fine: the date we need has not arrived.
    expect(offerableIntakes(undated, "2026-09-01").map((i) => i.code)).toEqual(["x"]);
  });

  it("returns the running term first, so it is the natural default", () => {
    expect(offerableIntakes(ALL, "2026-09-10")[0]?.code).toBe("t3-2026");
  });

  it("handles an empty calendar", () => {
    expect(offerableIntakes([], "2026-09-10")).toEqual([]);
  });
});
