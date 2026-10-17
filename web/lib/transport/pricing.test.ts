import { describe, expect, it } from "vitest";
import { customerTariffs, estimateBooking, estimateCustomerTotal, householdsFor, priceLine, providerTermNettMinor, tariffService, vatWithinMinor, type TariffLike } from "@/lib/transport/pricing";

/**
 * The school's sheet, "Hibiscus_Watermark_Shuttle_Fees.xlsx", row for row:
 * the parent's term price and the provider's own price excluding VAT (the
 * sheet's nett ÷ 1.026), with the nett the sheet shows. The same figures are
 * seeded by `20261016120000_transport_catalogue.sql` and checked there.
 */
const SHEET = [
  ["north", "full", "single", 515000, 436800, 448157],
  ["north", "full", "different_schools", 485000, 414400, 425174],
  ["north", "full", "same_school", 475000, 404800, 415325],
  ["north", "one_way", "single", 385000, 327600, 336118],
  ["north", "one_way", "different_schools", 365000, 311200, 319291],
  ["north", "one_way", "same_school", 360000, 303600, 311494],
  ["gaborone", "full", "single", 460000, 392000, 402192],
  ["gaborone", "full", "different_schools", 440000, 372800, 382493],
  ["gaborone", "full", "same_school", 425000, 363200, 372643],
  ["gaborone", "one_way", "single", 350000, 293600, 301234],
  ["gaborone", "one_way", "different_schools", 330000, 280000, 287280],
  ["gaborone", "one_way", "same_school", 320000, 271200, 278251],
] as const;

const TARIFFS: TariffLike[] = SHEET.map(([zone, service, household, customer, list], i) => ({
  id: `t${i}`,
  zone_id: zone,
  service,
  household,
  customer_term_minor: customer,
  provider_list_term_minor: list,
}));

const RATES = { rebateBp: 1000, vatBp: 1400 };

describe("the sheet", () => {
  for (const [zone, service, household, customer, list, nett] of SHEET) {
    it(`${zone}, ${service}, ${household}: P ${customer / 100} to the school, ${nett} thebe to the provider`, () => {
      const line = priceLine({ customerTermMinor: customer, providerListTermMinor: list, ...RATES, days: 5, divisor: 1 });
      expect(line.amountMinor).toBe(customer);
      expect(line.providerAmountMinor).toBe(nett);
      expect(line.retainedMinor).toBe(customer - nett);
      expect(providerTermNettMinor(list, RATES.rebateBp, RATES.vatBp)).toBe(nett);
    });
  }
});

describe("weekdays and months", () => {
  it("prices three afternoons as three fifths of the one-way term", () => {
    const line = priceLine({ customerTermMinor: 350000, providerListTermMinor: 293600, ...RATES, days: 3, divisor: 1 });
    expect(line).toEqual({ amountMinor: 210000, providerAmountMinor: 180740, retainedMinor: 29260 });
  });

  it("prices a month as a third of the term, rounded once", () => {
    const line = priceLine({ customerTermMinor: 515000, providerListTermMinor: 436800, ...RATES, days: 5, divisor: 3 });
    expect(line).toEqual({ amountMinor: 171667, providerAmountMinor: 149386, retainedMinor: 22281 });
  });

  it("can come to a thebe more over three months than the term — rounded once per line, never twice", () => {
    const month = priceLine({ customerTermMinor: 515000, providerListTermMinor: 436800, ...RATES, days: 5, divisor: 3 });
    expect(month.amountMinor * 3).toBe(515001);
  });

  it("refuses a day count the form should never send", () => {
    expect(() => priceLine({ customerTermMinor: 1, providerListTermMinor: 1, ...RATES, days: 0, divisor: 1 })).toThrow();
    expect(() => priceLine({ customerTermMinor: 1, providerListTermMinor: 1, ...RATES, days: 6, divisor: 1 })).toThrow();
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
    const estimate = estimateBooking({
      zoneId: "gaborone",
      divisor: 1,
      ...RATES,
      tariffs: TARIFFS,
      riders: [
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "b7", service: "full", days: 5 },
      ],
    });
    expect(estimate?.totalMinor).toBe(1290000);
    expect(estimate?.providerTotalMinor).toBe(1127779);
    expect(estimate?.lines.map((l) => l.household)).toEqual(["same_school", "same_school", "different_schools"]);
  });

  it("two at Broadhurst in Phakalane, a term", () => {
    const estimate = estimateBooking({
      zoneId: "north",
      divisor: 1,
      ...RATES,
      tariffs: TARIFFS,
      riders: [
        { campusId: "bh", service: "full", days: 5 },
        { campusId: "bh", service: "full", days: 5 },
      ],
    });
    expect(estimate?.totalMinor).toBe(950000);
    expect(estimate?.providerTotalMinor).toBe(830650);
  });

  it("is null when no tariff covers a child", () => {
    expect(estimateBooking({ zoneId: "nowhere", divisor: 1, ...RATES, tariffs: TARIFFS, riders: [{ campusId: "bh", service: "full", days: 5 }] })).toBeNull();
  });
});

describe("VAT", () => {
  it("is 14/114 of an amount that includes it", () => {
    expect(vatWithinMinor(515000, 1400)).toBe(63246);
    expect(vatWithinMinor(460000, 1400)).toBe(56491);
  });
});

describe("the estimate a parent's browser works out", () => {
  it("is given no provider price", () => {
    for (const t of customerTariffs(TARIFFS)) expect(Object.keys(t).sort()).toEqual(["customer_term_minor", "household", "service", "zone_id"]);
  });

  it("agrees with the full rule on every booking shape", () => {
    const riders = [
      { campusId: "bh", service: "full" as const, days: 5 },
      { campusId: "bh", service: "pm" as const, days: 3 },
      { campusId: "b7", service: "am" as const, days: 2 },
    ];
    for (const zoneId of ["north", "gaborone"]) {
      for (const divisor of [1, 3]) {
        for (let n = 1; n <= riders.length; n++) {
          const full = estimateBooking({ zoneId, divisor, ...RATES, tariffs: TARIFFS, riders: riders.slice(0, n) });
          const parent = estimateCustomerTotal({ zoneId, divisor, tariffs: customerTariffs(TARIFFS), riders: riders.slice(0, n) });
          expect(parent?.totalMinor).toBe(full?.totalMinor);
        }
      }
    }
  });
});
