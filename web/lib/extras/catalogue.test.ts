import { describe, expect, it } from "vitest";
import {
  applicableItems,
  basketTotal,
  earliestOrderBy,
  isOrderable,
  optionsOf,
  orderLines,
  outstandingTotal,
  type ItemLike,
  type SelectionLike,
} from "@/lib/extras/catalogue";

const item = (over: Partial<ItemLike> = {}): ItemLike => ({
  id: "i1",
  campus_id: "block7",
  grade_sort_min: null,
  grade_sort_max: null,
  amount_minor: 25000,
  currency: "BWP",
  options: [],
  allow_quantity: false,
  order_by: null,
  is_active: true,
  sort_order: 0,
  ...over,
});

const sel = (over: Partial<SelectionLike> = {}): SelectionLike => ({
  item_id: "i1",
  quantity: 1,
  unit_amount_minor: 25000,
  currency: "BWP",
  status: "selected",
  ...over,
});

describe("applicableItems", () => {
  it("offers only this campus's items", () => {
    const items = [item({ id: "a" }), item({ id: "b", campus_id: "potch" })];
    expect(applicableItems(items, { campusId: "block7", gradeSort: 40 }).map((i) => i.id)).toEqual(["a"]);
  });

  it("respects a grade band at either end, and both", () => {
    const items = [
      item({ id: "lower", grade_sort_max: 30 }),
      item({ id: "upper", grade_sort_min: 50 }),
      item({ id: "middle", grade_sort_min: 30, grade_sort_max: 50 }),
      item({ id: "all" }),
    ];
    expect(applicableItems(items, { campusId: "block7", gradeSort: 40 }).map((i) => i.id)).toEqual(["middle", "all"]);
  });

  it("shows a child with no grade only what applies to everyone", () => {
    // A Stage 6 stationery pack offered for a three-year-old is worse than
    // offering nothing.
    const items = [item({ id: "banded", grade_sort_min: 50 }), item({ id: "all" })];
    expect(applicableItems(items, { campusId: "block7", gradeSort: null }).map((i) => i.id)).toEqual(["all"]);
  });

  it("hides what the school switched off", () => {
    expect(applicableItems([item({ is_active: false })], { campusId: "block7", gradeSort: 40 })).toEqual([]);
  });

  it("keeps the school's order", () => {
    const items = [item({ id: "b", sort_order: 20 }), item({ id: "a", sort_order: 10 })];
    expect(applicableItems(items, { campusId: "block7", gradeSort: 40 }).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("isOrderable", () => {
  it("closes on the day after the order-by date", () => {
    const i = item({ order_by: "2027-01-05" });
    expect(isOrderable(i, "2027-01-05")).toBe(true);
    expect(isOrderable(i, "2027-01-06")).toBe(false);
  });

  it("stays open forever without a date", () => {
    expect(isOrderable(item({ order_by: null }), "2099-01-01")).toBe(true);
  });
});

describe("optionsOf", () => {
  it("reads a list of strings and ignores anything else", () => {
    expect(optionsOf(["Phakalane AM", "Mogoditshane AM"])).toEqual(["Phakalane AM", "Mogoditshane AM"]);
    expect(optionsOf(["ok", 3, null, "  "])).toEqual(["ok"]);
    expect(optionsOf(null)).toEqual([]);
    expect(optionsOf({ a: 1 })).toEqual([]);
  });
});

describe("basketTotal", () => {
  it("multiplies by quantity and adds the lines up", () => {
    const b = basketTotal([sel({ quantity: 2 }), sel({ item_id: "i2", unit_amount_minor: 50000 })]);
    expect(b.totalMinor).toBe(100000);
    expect(b.currency).toBe("BWP");
    expect(b.lines).toBe(2);
  });

  it("leaves a cancelled line out entirely", () => {
    const b = basketTotal([sel(), sel({ item_id: "i2", status: "cancelled", unit_amount_minor: 99999 })]);
    expect(b.totalMinor).toBe(25000);
    expect(b.lines).toBe(1);
  });

  it("still counts a paid line, because the total is what the order came to", () => {
    expect(basketTotal([sel({ status: "paid" })]).totalMinor).toBe(25000);
  });

  it("refuses to name a currency for a basket that mixes two", () => {
    // Pula added to rand is a number that is wrong in both, and a page that
    // showed it would be lying confidently.
    const b = basketTotal([sel(), sel({ item_id: "i2", currency: "ZAR" })]);
    expect(b.currency).toBeNull();
  });

  it("is empty, not broken, with nothing chosen", () => {
    expect(basketTotal([])).toEqual({ totalMinor: 0, currency: null, lines: 0 });
  });
});

describe("outstandingTotal", () => {
  it("counts only what has not been paid for", () => {
    const s = [sel(), sel({ item_id: "i2", status: "paid", unit_amount_minor: 90000 })];
    expect(basketTotal(s).totalMinor).toBe(115000);
    expect(outstandingTotal(s).totalMinor).toBe(25000);
  });
});

describe("orderLines", () => {
  const items = [
    { id: "i1", code: "stationery_pack", label: "Stationery pack" },
    { id: "i2", code: "lunch_term", label: "Lunch, per term" },
  ];

  it("prices each line from the selection, not the catalogue", () => {
    // The item now costs more than it did in November; the family pays November's
    // price, which is the whole reason the selection snapshots it.
    const lines = orderLines([sel({ unit_amount_minor: 20000 })], items);
    expect(lines).toEqual([{ code: "stationery_pack", label: "Stationery pack", amount_minor: 20000 }]);
  });

  it("says a quantity out loud rather than hiding it in the total", () => {
    const lines = orderLines([sel({ quantity: 3, unit_amount_minor: 25000 })], items);
    expect(lines[0].label).toBe("Stationery pack × 3");
    expect(lines[0].amount_minor).toBe(75000);
  });

  it("still produces a payable line when the item has been renamed away", () => {
    const lines = orderLines([sel({ item_id: "gone" })], items);
    expect(lines[0]).toEqual({ code: "gone", label: "Optional extra", amount_minor: 25000 });
  });

  it("adds up to the same figure the basket showed", () => {
    const chosen = [sel({ quantity: 2 }), sel({ item_id: "i2", unit_amount_minor: 90000 })];
    const total = orderLines(chosen, items).reduce((sum, l) => sum + l.amount_minor, 0);
    expect(total).toBe(basketTotal(chosen).totalMinor);
  });
});

describe("earliestOrderBy", () => {
  it("takes the soonest date, because that is the one that lapses first", () => {
    expect(earliestOrderBy([{ order_by: "2026-02-01" }, { order_by: "2026-01-15" }, { order_by: null }])).toBe("2026-01-15");
  });

  it("is null when nothing ordered has a date", () => {
    expect(earliestOrderBy([{ order_by: null }, { order_by: null }])).toBeNull();
    expect(earliestOrderBy([])).toBeNull();
  });
});
