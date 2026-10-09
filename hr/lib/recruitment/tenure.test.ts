import { describe, expect, it } from "vitest";
import { formatMonths, monthsBetween, summariseTenure } from "@/lib/recruitment/tenure";

const today = new Date("2026-10-12T10:00:00Z");

describe("monthsBetween", () => {
  it("counts whole months only", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
    expect(monthsBetween("2020-01-01", "2026-01-01")).toBe(72);
  });

  it("never goes negative", () => {
    expect(monthsBetween("2026-05-01", "2026-01-01")).toBe(0);
  });
});

describe("summariseTenure", () => {
  it("averages finished jobs", () => {
    const s = summariseTenure(
      [
        { start_on: "2015-01-01", end_on: "2018-01-01" }, // 36
        { start_on: "2018-01-01", end_on: "2020-01-01" }, // 24
      ],
      today
    );
    expect(s.averageMonths).toBe(30);
    expect(s.totalMonths).toBe(60);
  });

  it("does not count a new current job against the applicant", () => {
    const s = summariseTenure(
      [
        { start_on: "2016-01-01", end_on: "2026-01-01" }, // 120
        { start_on: "2026-07-01", end_on: null }, // 3, current: not counted
      ],
      today
    );
    expect(s.averageMonths).toBe(120);
  });

  it("counts a current job once it has run a year", () => {
    const s = summariseTenure([{ start_on: "2020-10-01", end_on: null }], today);
    expect(s.jobs[0]).toMatchObject({ months: 72, current: true });
    expect(s.averageMonths).toBe(72);
  });

  it("finds a gap of more than six months", () => {
    const s = summariseTenure(
      [
        { start_on: "2015-01-01", end_on: "2018-01-01" },
        { start_on: "2019-03-01", end_on: "2022-01-01" },
      ],
      today
    );
    expect(s.gaps).toEqual([{ fromOn: "2018-01-01", toOn: "2019-03-01", months: 14 }]);
  });

  it("ignores a short gap", () => {
    const s = summariseTenure(
      [
        { start_on: "2015-01-01", end_on: "2018-01-01" },
        { start_on: "2018-04-01", end_on: "2022-01-01" },
      ],
      today
    );
    expect(s.gaps).toEqual([]);
  });

  it("finds overlapping jobs and counts the overlap once in the total", () => {
    const s = summariseTenure(
      [
        { start_on: "2018-01-01", end_on: "2020-01-01" },
        { start_on: "2019-01-01", end_on: "2021-01-01" },
      ],
      today
    );
    expect(s.overlaps).toEqual([{ a: 0, b: 1, months: 12 }]);
    expect(s.totalMonths).toBe(36);
  });

  it("separates school experience from other work", () => {
    const s = summariseTenure(
      [
        { start_on: "2010-01-01", end_on: "2015-01-01", is_school: false },
        { start_on: "2015-01-01", end_on: "2020-01-01", is_school: true },
      ],
      today
    );
    expect(s.schoolMonths).toBe(60);
    expect(s.totalMonths).toBe(120);
  });

  it("copes with no jobs at all", () => {
    expect(summariseTenure([], today)).toMatchObject({ totalMonths: 0, averageMonths: null, gaps: [], overlaps: [] });
  });
});

describe("formatMonths", () => {
  it("reads naturally", () => {
    expect(formatMonths(0)).toBe("less than a month");
    expect(formatMonths(1)).toBe("1 month");
    expect(formatMonths(12)).toBe("1 year");
    expect(formatMonths(40)).toBe("3 years 4 months");
  });
});
