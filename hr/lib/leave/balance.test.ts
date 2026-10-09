import { describe, expect, it } from "vitest";
import { balancesFor, entitlementFor, monthsEmployedIn, overlaps, type LeaveTypeLite } from "@/lib/leave/balance";

const types: LeaveTypeLite[] = [
  { code: "annual", name: "Annual leave", days_per_year: 15, country: null, is_active: true },
  { code: "sick", name: "Sick leave", days_per_year: 10, country: null, is_active: true },
  { code: "family", name: "Family responsibility leave", days_per_year: 3, country: "ZA", is_active: true },
  { code: "compassionate", name: "Compassionate leave", days_per_year: 3, country: "BW", is_active: true },
  { code: "unpaid", name: "Unpaid leave", days_per_year: 0, country: null, is_active: true },
];

describe("leave entitlement", () => {
  it("gives a full year to someone employed all year", () => {
    expect(monthsEmployedIn(2026, "2020-01-15", null)).toBe(12);
    expect(entitlementFor(types[0], 2026, { start_date: "2020-01-15", end_date: null }, null)).toBe(15);
  });

  it("gives a share of the year to someone who starts part way through, to the half day", () => {
    // Starts in July: July to December is 6 months, so 7.5 days.
    expect(monthsEmployedIn(2026, "2026-07-20", null)).toBe(6);
    expect(entitlementFor(types[0], 2026, { start_date: "2026-07-20", end_date: null }, null)).toBe(7.5);
    // Starts in October: 3 months of 10 days is 2.5.
    expect(entitlementFor(types[1], 2026, { start_date: "2026-10-01", end_date: null }, null)).toBe(2.5);
  });

  it("gives nothing for a year before someone started or after they left", () => {
    expect(monthsEmployedIn(2025, "2026-01-01", null)).toBe(0);
    expect(monthsEmployedIn(2027, "2020-01-01", "2026-03-31")).toBe(0);
    expect(monthsEmployedIn(2026, "2020-01-01", "2026-03-31")).toBe(3);
  });

  it("uses a person's own allowance when HR has set one", () => {
    expect(entitlementFor(types[0], 2026, { start_date: "2026-07-01", end_date: null }, 20)).toBe(20);
  });

  it("has no allowance for a type without one", () => {
    expect(entitlementFor(types[4], 2026, { start_date: "2020-01-01", end_date: null }, null)).toBeNull();
  });
});

describe("leave balances", () => {
  const employee = { start_date: "2020-01-01", end_date: null };
  const requests = [
    { leave_type_code: "annual", starts_on: "2026-04-06", days: 5, status: "approved" },
    { leave_type_code: "annual", starts_on: "2026-12-21", days: 3, status: "pending" },
    { leave_type_code: "annual", starts_on: "2026-06-01", days: 2, status: "declined" },
    { leave_type_code: "annual", starts_on: "2025-12-22", days: 4, status: "approved" },
    { leave_type_code: "unpaid", starts_on: "2026-02-02", days: 1, status: "approved" },
  ];

  it("takes away approved days in the year, and shows pending days apart", () => {
    const b = balancesFor({ year: 2026, country: "BW", employee, types, requests, overrides: {} });
    const annual = b.find((x) => x.code === "annual")!;
    expect(annual).toMatchObject({ entitledDays: 15, takenDays: 5, pendingDays: 3, remainingDays: 10 });
    expect(b.find((x) => x.code === "unpaid")).toMatchObject({ entitledDays: null, takenDays: 1, remainingDays: null });
  });

  it("shows only the types for the employee's country", () => {
    const bw = balancesFor({ year: 2026, country: "BW", employee, types, requests: [], overrides: {} }).map((x) => x.code);
    const za = balancesFor({ year: 2026, country: "ZA", employee, types, requests: [], overrides: {} }).map((x) => x.code);
    expect(bw).toContain("compassionate");
    expect(bw).not.toContain("family");
    expect(za).toContain("family");
    expect(za).not.toContain("compassionate");
  });
});

describe("overlapping leave", () => {
  it("finds a shared day, and ignores declined requests", () => {
    expect(overlaps({ starts_on: "2026-04-06", ends_on: "2026-04-10" }, { starts_on: "2026-04-10", ends_on: "2026-04-14", status: "approved" })).toBe(true);
    expect(overlaps({ starts_on: "2026-04-06", ends_on: "2026-04-10" }, { starts_on: "2026-04-11", ends_on: "2026-04-14", status: "pending" })).toBe(false);
    expect(overlaps({ starts_on: "2026-04-06", ends_on: "2026-04-10" }, { starts_on: "2026-04-08", ends_on: "2026-04-08", status: "declined" })).toBe(false);
  });
});
