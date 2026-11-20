import { describe, expect, it } from "vitest";
import { dueState, endOfWeek, itemStatus, mergeLines, nextSchoolDay, quantityLine, quickReturnDates, storesErrorMessage, totalOf } from "@/lib/stores/rules";

const item = (o: Partial<Parameters<typeof itemStatus>[0]> = {}) => ({
  item_type: "reusable" as const, qty_available: 5, qty_checked_out: 0, qty_assigned: 0, qty_unavailable: 0, min_stock: 0, ...o,
});

describe("itemStatus", () => {
  it("reads Available when everything is on the shelf", () => expect(itemStatus(item())).toBe("available"));
  it("reads Partially Available when some equipment is out", () => expect(itemStatus(item({ qty_checked_out: 2 }))).toBe("partially_available"));
  it("counts assigned and held-back stock as not on the shelf", () => {
    expect(itemStatus(item({ qty_assigned: 1 }))).toBe("partially_available");
    expect(itemStatus(item({ qty_unavailable: 1 }))).toBe("partially_available");
  });
  it("reads Checked Out when every one is on loan", () => expect(itemStatus(item({ qty_available: 0, qty_checked_out: 5 }))).toBe("checked_out"));
  it("reads Out of Stock when nothing is left and none of it is merely on loan", () => {
    expect(itemStatus(item({ qty_available: 0 }))).toBe("out_of_stock");
    expect(itemStatus(item({ qty_available: 0, qty_checked_out: 2, qty_unavailable: 1 }))).toBe("out_of_stock");
  });
  it("reads Low Stock at or under the reorder level, and never at a level of zero", () => {
    expect(itemStatus(item({ item_type: "consumable", qty_available: 3, min_stock: 3 }))).toBe("low_stock");
    expect(itemStatus(item({ item_type: "consumable", qty_available: 4, min_stock: 3 }))).toBe("available");
    expect(itemStatus(item({ item_type: "consumable", qty_available: 1, min_stock: 0 }))).toBe("available");
  });
  it("adds the four buckets for the total", () => expect(totalOf(item({ qty_checked_out: 2, qty_assigned: 1, qty_unavailable: 1 }))).toBe(9));
});

describe("dueState", () => {
  it("is overdue the day after the return date", () => {
    expect(dueState("2026-11-19", "2026-11-20")).toMatchObject({ state: "overdue", tone: "destructive", label: "Overdue by 1 day" });
    expect(dueState("2026-11-10", "2026-11-20").label).toBe("Overdue by 10 days");
  });
  it("is due soon, in amber, on the day and within the window", () => {
    expect(dueState("2026-11-20", "2026-11-20")).toMatchObject({ state: "due_soon", tone: "warning", label: "Due today" });
    expect(dueState("2026-11-21", "2026-11-20").label).toBe("Due tomorrow");
    expect(dueState("2026-11-22", "2026-11-20").state).toBe("due_soon");
  });
  it("is plainly on loan beyond the window", () => expect(dueState("2026-11-25", "2026-11-20")).toMatchObject({ state: "on_loan", tone: "secondary" }));
  it("crosses a month end correctly", () => expect(dueState("2026-12-01", "2026-11-30").label).toBe("Due tomorrow"));
});

describe("return dates", () => {
  it("skips the weekend for the next school day", () => {
    expect(nextSchoolDay("2026-11-20")).toBe("2026-11-23"); // Friday → Monday
    expect(nextSchoolDay("2026-11-18")).toBe("2026-11-19");
  });
  it("finds the coming Friday", () => {
    expect(endOfWeek("2026-11-18")).toBe("2026-11-20");
    expect(endOfWeek("2026-11-20")).toBe("2026-11-27");
  });
  it("never offers the same date twice", () => {
    const dates = quickReturnDates("2026-11-19").map((d) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates[0]).toBe("2026-11-19");
  });
});

describe("quantityLine and mergeLines", () => {
  it("writes the spec's own lines", () => {
    expect(quantityLine(2, "Portable Speakers", "each")).toBe("2 × Portable Speakers");
    expect(quantityLine(5, "Floor Cleaner", "Litres")).toBe("5 litres Floor Cleaner");
  });
  it("adds two lines for one item together and drops empty ones", () => {
    expect(mergeLines([{ item_id: "a", quantity: 2 }, { item_id: "b", quantity: 0 }, { item_id: "a", quantity: 1 }])).toEqual([{ item_id: "a", quantity: 3 }]);
  });
});

describe("storesErrorMessage", () => {
  it("passes the database's own sentence through", () => {
    expect(storesErrorMessage({ message: 'Only 2 of "Projector" available, and 3 were asked for.', code: "23514" })).toContain("Only 2");
  });
  it("never shows Postgres talking about itself", () => {
    expect(storesErrorMessage({ message: "permission denied for table stores_items", code: "42501" })).toBe("You do not have permission to do that.");
    expect(storesErrorMessage({ message: 'duplicate key value violates unique constraint "stores_departments_name_key"', code: "23505" })).toMatch(/already in use/);
    expect(storesErrorMessage({ message: "", code: "" })).toMatch(/Something went wrong/);
  });
});
