import { describe, expect, it } from "vitest";
import { dayOfMonth, daysInMonth, monthGrid, monthsOf, weekdayIndex } from "@/lib/calendar";

describe("weekdayIndex", () => {
  it("counts from Monday", () => {
    // 14 September 2026 is a Monday; the 20th is the Sunday that ends its week.
    expect(weekdayIndex(2026, 9, 14)).toBe(0);
    expect(weekdayIndex(2026, 9, 20)).toBe(6);
  });
});

describe("daysInMonth", () => {
  it("knows the short months", () => {
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("knows February in and out of a leap year", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    // 2100 is divisible by four and is not a leap year.
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe("monthsOf", () => {
  it("keeps first-seen order and does not repeat", () => {
    expect(monthsOf(["2026-09-14", "2026-09-30", "2026-10-01", "2026-10-02"])).toEqual([
      "2026-09",
      "2026-10",
    ]);
  });

  it("crosses a year end", () => {
    expect(monthsOf(["2026-12-14", "2027-01-11"])).toEqual(["2026-12", "2027-01"]);
  });

  it("has nothing to say about no dates", () => {
    expect(monthsOf([])).toEqual([]);
  });
});

describe("monthGrid", () => {
  it("pads to the weekday the month starts on", () => {
    // 1 September 2026 is a Tuesday: one blank before it.
    const grid = monthGrid("2026-09");
    expect(grid.slice(0, 3)).toEqual([null, "2026-09-01", "2026-09-02"]);
    expect(grid).toHaveLength(1 + 30);
    expect(grid.at(-1)).toBe("2026-09-30");
  });

  it("pads a full week when the month starts on a Sunday", () => {
    // 1 February 2026 is a Sunday: six blanks, the whole row before it.
    const grid = monthGrid("2026-02");
    expect(grid.filter((c) => c === null)).toHaveLength(6);
    expect(grid[6]).toBe("2026-02-01");
  });

  it("needs no padding when the month starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(monthGrid("2026-06")[0]).toBe("2026-06-01");
  });

  it("zero-pads the day so every cell is a real date key", () => {
    expect(monthGrid("2026-09")).toContain("2026-09-09");
  });
});

describe("dayOfMonth", () => {
  it("reads the day without parsing a date", () => {
    expect(dayOfMonth("2026-09-01")).toBe(1);
    expect(dayOfMonth("2026-09-30")).toBe(30);
  });
});
