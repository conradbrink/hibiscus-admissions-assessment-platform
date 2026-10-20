import { describe, expect, it } from "vitest";
import { customerLineMinor, customerTariffs, estimateCustomerTotal, householdsFor, tariffService, type CustomerTariff } from "@/lib/transport/pricing";

/**
 * The parent's side of the school's sheet, "Hibiscus_Watermark_Shuttle_Fees.xlsx",
 * row for row. The same figures are seeded by
 * `20261016120000_transport_catalogue.sql` and checked there; the provider's
 * side (its nett) is checked only in the database, where its prices live.
 */
const SHEET = [
  ["north", "full", "single", 515000],
  ["north", "full", "different_schools", 485000],
  ["north", "full", "same_school", 475000],
  ["north", "one_way", "single", 385000],
  ["north", "one_way", "different_schools", 365000],
  ["north", "one_way", "same_school", 360000],
  ["gaborone", "full", "single", 460000],
  ["gaborone", "full", "different_schools", 440000],
  ["gaborone", "full", "same_school", 425000],
  ["gaborone", "one_way", "single", 350000],
  ["gaborone", "one_way", "different_schools", 330000],
  ["gaborone", "one_way", "same_school", 320000],
] as const;

const TARIFFS: CustomerTariff[] = SHEET.map(([zone, service, household, customer]) => ({
  zone_id: zone,
  service,
  household,
  customer_term_minor: customer,
}));

describe("the sheet", () => {
  for (const [zone, service, household, customer] of SHEET) {
    it(`${zone}, ${service}, ${household}: P ${customer / 100} a term, every day`, () => {
      expect(customerLineMinor(customer, 5, 1)).toBe(customer);
    });
  }
});

describe("weekdays and months", () => {
  it("prices three afternoons as three fifths of the one-way term", () => {
    expect(customerLineMinor(350000, 3, 1)).toBe(210000);
  });

  it("prices a month as a third of the term, rounded once", () => {
    expect(customerLineMinor(515000, 5, 3)).toBe(171667);
  });

  it("can come to a thebe more over three months than the term — rounded once per line, never twice", () => {
    expect(customerLineMinor(515000, 5, 3) * 3).toBe(515001);
  });

  it("refuses a day count the form should never send", () => {
    expect(() => customerLineMinor(1, 0, 1)).toThrow();
    expect(() => customerLineMinor(1, 6, 1)).toThrow();
  });
});

describe("the sibling rate is per child", () => {
  it("is single for one child", () => {
    expect(householdsFor(["bh"])).toEqual(["single"]);
  });

  it("counts shared schools child by child", () => {
    expect(householdsFor(["bh", "bh", "b7"])).toEqual(["same_school", "same_school", "different_schools"]);
    expect(householdsFor(["bh", "b7"])).toEqual(["different_schools", "different_schools"]);
  });

  it("prices morning and afternoon only at the one-way rate", () => {
    expect(tariffService("am")).toBe("one_way");
    expect(tariffService("pm")).toBe("one_way");
    expect(tariffService("full")).toBe("full");
  });
});

describe("a whole booking", () => {
  it("two at Broadhurst and one at Block 7, Gaborone, every day, a term", () => {
    const estimate = estimateCustomerTotal({
      zoneId: "gaborone",
      divisor: 1,
      tariffs: TARIFFS,
      riders: [
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "b7", service: "full", days: 5 },
      ],
    });
    expect(estimate?.totalMinor).toBe(1290000);
    expect(estimate?.lines.map((l) => l.household)).toEqual(["same_school", "same_school", "different_schools"]);
  });

  it("two at Broadhurst in Phakalane, a term", () => {
    const estimate = estimateCustomerTotal({
      zoneId: "north",
      divisor: 1,
      tariffs: TARIFFS,
      riders: [
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "bh", service: "full", days: 5 },
      ],
    });
    expect(estimate?.totalMinor).toBe(950000);
  });

  it("a month of mixed days, line by line", () => {
    const estimate = estimateCustomerTotal({
      zoneId: "gaborone",
      divisor: 3,
      tariffs: TARIFFS,
      riders: [
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "bh", service: "pm", days: 3 },
        { campusId: "b7", service: "am", days: 2 },
      ],
    });
    // 425000/3, 320000 × 3/15 and 330000 × 2/15, each rounded once.
    expect(estimate?.lines.map((l) => l.amountMinor)).toEqual([141667, 64000, 44000]);
    expect(estimate?.totalMinor).toBe(249667);
  });

  it("is null when no tariff covers a child", () => {
    expect(estimateCustomerTotal({ zoneId: "nowhere", divisor: 1, tariffs: TARIFFS, riders: [{ campusId: "bh", service: "full", days: 5 }] })).toBeNull();
  });
});

describe("the estimate a parent's browser works out", () => {
  it("is given only the parent's price, whatever else a tariff row carries", () => {
    const wider = TARIFFS.map((t) => ({ ...t, id: "t", provider_list_term_minor: 1, price_list_id: "p" }));
    for (const t of customerTariffs(wider)) expect(Object.keys(t).sort()).toEqual(["customer_term_minor", "household", "service", "zone_id"]);
  });
});
