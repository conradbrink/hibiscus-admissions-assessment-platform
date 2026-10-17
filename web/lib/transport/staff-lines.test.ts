import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { readWorkbook } from "@/lib/xlsx-read";
import { earningsSheets } from "@/lib/transport/earnings";
import { chargeableRiders, creditableRiders, parsePayoutForm, payoutFilename, payoutSheets, statementLines } from "@/lib/transport/payout";
import { seatWindows, type PeriodLike } from "@/lib/transport/periods";
import { CANCELLED_HEADERS, cancelledAfterPayment, dayCounts, RIDER_HEADERS, riderListFilename, riderListSheets, windowCounts } from "@/lib/transport/rider-list";
import { byRoute, isRiding, toStaffRider, type RiderSelectRow, type StaffRider } from "@/lib/transport/staff-rider";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROVIDER = ID(900);

const term: PeriodLike = { id: "t1", kind: "term", term_period_id: null, month_index: null, label: "Term 1, 2027", starts_on: "2027-01-11", ends_on: "2027-04-09" };
const jan: PeriodLike = { id: "t1m1", kind: "month", term_period_id: "t1", month_index: 1, label: "January 2027", starts_on: "2027-01-11", ends_on: "2027-01-31" };
const periods = new Map([term, jan].map((p) => [p.id, p]));

let seq = 0;
function rider(over: Partial<Omit<StaffRider, "booking">> & { booking?: Partial<StaffRider["booking"]> } = {}): StaffRider {
  seq += 1;
  const { booking, ...rest } = over;
  return {
    id: ID(seq),
    bookingId: ID(100),
    reference: "HTR-2027-00001",
    position: 1,
    firstName: "Neo",
    lastName: "Kgosi",
    campusId: ID(500),
    school: "Broadhurst",
    schoolSort: 6,
    grade: "Grade 2",
    gradeSort: 4,
    service: "full",
    days: { mon: true, tue: true, wed: true, thu: true, fri: true },
    daysCount: 5,
    household: "same_school",
    amountMinor: 425000,
    providerAmountMinor: 372643,
    refundMinor: 0,
    status: "booked",
    cancelledAt: null,
    notes: null,
    items: [],
    ...rest,
    booking: {
      status: "paid",
      paidAt: "2026-12-01T08:00:00Z",
      anonymised: false,
      periodId: "t1",
      providerId: PROVIDER,
      parentFirstName: "Mpho",
      parentLastName: "Kgosi",
      mobile: "+26771234567",
      secondContactName: null,
      secondContactMobile: null,
      address: "Plot 1234, Phakalane",
      landmark: "Opposite the clinic",
      notes: null,
      area: "Phakalane",
      areaSort: 1,
      zone: "North",
      zoneSort: 1,
      ...booking,
    },
  };
}

describe("toStaffRider", () => {
  it("flattens the embedded select, whether an embed comes back as an object or an array", () => {
    const row: RiderSelectRow = {
      id: ID(1),
      booking_id: ID(2),
      position: 2,
      first_name: "Neo",
      last_name: "Kgosi",
      campus_id: ID(3),
      service: "am",
      mon: true,
      tue: false,
      wed: true,
      thu: false,
      fri: false,
      days_count: 2,
      household: "single",
      amount_minor: 154000,
      provider_amount_minor: 120494,
      refund_minor: 0,
      status: "booked",
      cancelled_at: null,
      notes: null,
      campuses: [{ name: "Block 7", sort_order: 7 }],
      grades: { name: "Grade 1", sort_order: 3 },
      transport_bookings: {
        reference: "HTR-2027-00002",
        status: "paid",
        paid_at: "2026-12-01T08:00:00Z",
        anonymised_at: null,
        period_id: "t1",
        provider_id: PROVIDER,
        parent_first_name: "Mpho",
        parent_last_name: "Kgosi",
        mobile: null,
        second_contact_name: null,
        second_contact_mobile: null,
        address_line: "Plot 9",
        landmark: null,
        notes: null,
        transport_areas: { name: "Gaborone", sort_order: 4 },
        transport_zones: [{ label: "Gaborone", sort_order: 2 }],
      },
      transport_payout_items: [{ kind: "charge", amount_minor: 120494, payout_id: ID(77) }],
    };
    const r = toStaffRider(row)!;
    expect(r).toMatchObject({ school: "Block 7", grade: "Grade 1", reference: "HTR-2027-00002", days: { mon: true, wed: true, tue: false } });
    expect(r.booking).toMatchObject({ area: "Gaborone", zone: "Gaborone", zoneSort: 2 });
    expect(r.items).toEqual([{ kind: "charge", amountMinor: 120494, payoutId: ID(77) }]);
    expect(toStaffRider({ ...row, transport_bookings: null })).toBeNull();
  });
});

describe("the rider list for the provider", () => {
  const riders = [
    rider({ lastName: "Zulu", firstName: "Amo" }),
    rider({ lastName: "Moyo", firstName: "Lesedi", service: "am", days: { mon: true, tue: false, wed: true, thu: false, fri: false } }),
    rider({ lastName: "Dube", school: "Block 7", schoolSort: 7, booking: { area: "Gaborone", areaSort: 4, zone: "Gaborone", zoneSort: 2, periodId: "t1m1" } }),
    rider({ lastName: "Unpaid", booking: { status: "awaiting_payment", paidAt: null } }),
    rider({ lastName: "Gone", status: "cancelled", cancelledAt: "2027-01-20T23:30:00Z", booking: { status: "paid" } }),
    rider({ lastName: "Removed", firstName: "Removed", booking: { anonymised: true } }),
  ];
  const meta = {
    providerName: "Watermark Tours",
    periodLabel: "Term 1, 2027",
    takenAt: "18 Oct 2026, 09:00",
    takenBy: "Coordinator",
    schools: ["Broadhurst", "Block 7"],
    unpaidBookings: 1,
    windows: seatWindows([term, jan], "t1"),
  };

  it("names no email address and no price", () => {
    for (const h of [...RIDER_HEADERS, ...CANCELLED_HEADERS]) expect(h).not.toMatch(/email|price|amount|paid|fee|P\b/i);
  });

  it("holds only children still booked on a paid booking, in route order, with the period's dates", () => {
    const [list] = riderListSheets(riders, periods, meta);
    const surname = RIDER_HEADERS.indexOf("Child surname");
    expect(list.rows.map((r) => r[surname])).toEqual(["Moyo", "Zulu", "Dube"]);
    const dube = list.rows[2];
    expect(dube[RIDER_HEADERS.indexOf("Booked for")]).toBe("January 2027");
    expect(dube[RIDER_HEADERS.indexOf("From")]).toBe("2027-01-11");
    const moyo = list.rows[0];
    expect(RIDER_HEADERS.slice(9, 14).map((_, i) => moyo[9 + i])).toEqual(["Yes", "", "Yes", "", ""]);
    expect(moyo[RIDER_HEADERS.indexOf("Mobile")]).toBe("+267 71 234 567");
  });

  it("puts children cancelled after payment on their own sheet, dated in Gaborone", () => {
    const cancelled = riderListSheets(riders, periods, meta)[2];
    expect(cancelled.rows).toEqual([["HTR-2027-00001", "Neo", "Gone", "Broadhurst", "Phakalane", "Term 1, 2027", "2027-01-21"]]);
  });

  it("counts seats by area and school for each morning and afternoon run", () => {
    const { rows, total } = dayCounts(riders);
    expect(rows.map((r) => [r.area, r.school, r.children])).toEqual([
      ["Phakalane", "Broadhurst", 2],
      ["Gaborone", "Block 7", 1],
    ]);
    // Zulu rides both runs every day; Moyo rides Monday and Wednesday mornings.
    expect(rows[0].slots).toMatchObject({ mon_am: 2, mon_pm: 1, tue_am: 1, wed_am: 2, fri_pm: 1 });
    expect(total.children).toBe(3);
    expect(total.slots.mon_am).toBe(3);
  });

  it("opens in Excel's reader with the counts as numbers and an about sheet saying what is missing", () => {
    const sheets = readWorkbook(buildWorkbook(riderListSheets(riders, periods, meta)));
    expect(sheets.map((s) => s.name)).toEqual(["Riders", "Counts", "Cancelled", "About this list"]);
    expect(sheets[1].rows.at(-1)?.slice(0, 5)).toEqual(["January 2027", "All", "All", "3", "3"]);
    const about = Object.fromEntries(sheets[3].rows.slice(1).map(([k, v]) => [k, v]));
    expect(about["Children riding"]).toBe("3");
    expect(about["Not in this list"]).toMatch(/1 booking is not paid yet/);
  });

  it("counts a term's seats month by month, so children booked for different months never share a seat", () => {
    const feb: PeriodLike = { id: "t1m2", kind: "month", term_period_id: "t1", month_index: 2, label: "February 2027", starts_on: "2027-02-01", ends_on: "2027-02-28" };
    const all = [term, jan, feb];
    // One child on the term, and one booked month by month (two bookings).
    const monthly = [
      rider({ lastName: "Term" }),
      rider({ lastName: "Monthly", reference: "HTR-2027-00002", booking: { periodId: "t1m1" } }),
      rider({ lastName: "Monthly", reference: "HTR-2027-00003", booking: { periodId: "t1m2" } }),
    ];
    const windows = windowCounts(monthly, seatWindows(all, "t1"));
    expect(windows.map((w) => [w.window.label, w.riding, w.total.slots.mon_am])).toEqual([
      ["January 2027", 2, 2],
      ["February 2027", 2, 2],
    ]);
    const sheets = riderListSheets(monthly, new Map(all.map((p) => [p.id, p])), { ...meta, windows: seatWindows(all, "t1") });
    // The list has a row per booking; the seats never reach three.
    expect(sheets[0].rows).toHaveLength(3);
    expect(Math.max(...sheets[1].rows.map((r) => Number(r[4])))).toBe(2);
    const about = Object.fromEntries(sheets[3].rows.map(([k, v]) => [k, v]));
    expect(about["Children riding"]).toBe("January 2027: 2; February 2027: 2");
    // A single month is its own window, with the term's children in it.
    expect(seatWindows(all, "t1m2")).toEqual([{ id: "t1m2", label: "February 2027", periodIds: ["t1m2", "t1"] }]);
  });

  it("leaves off the cancelled sheet a booking cancelled before its money arrived", () => {
    const late = rider({ lastName: "Late", status: "cancelled", cancelledAt: "2027-01-05T08:00:00Z", booking: { status: "cancelled", paidAt: "2027-01-06T08:00:00Z" } });
    const after = rider({ lastName: "After", status: "cancelled", cancelledAt: "2027-01-07T08:00:00Z", booking: { status: "cancelled", paidAt: "2027-01-06T08:00:00Z" } });
    expect([late, after].filter(cancelledAfterPayment).map((r) => r.lastName)).toEqual(["After"]);
  });

  it("is named for the provider, the period and the day", () => {
    expect(riderListFilename("watermark", "Term 1, 2027", "2026-10-18")).toBe("watermark-riders-term-1-2027-2026-10-18.xlsx");
  });

  it("orders by zone, area, school and name", () => {
    expect([...riders].filter(isRiding).sort(byRoute).map((r) => r.lastName)).toEqual(["Moyo", "Zulu", "Dube"]);
  });
});

describe("paying the provider", () => {
  const charged = { kind: "charge" as const, amountMinor: 372643, payoutId: ID(800) };
  const riders = [
    rider({ lastName: "Owed" }),
    rider({ lastName: "Paid", items: [charged] }),
    rider({ lastName: "Unpaid", booking: { status: "awaiting_payment", paidAt: null } }),
    rider({ lastName: "Elsewhere", booking: { providerId: ID(901) } }),
    rider({ lastName: "CancelledBefore", status: "cancelled" }),
    rider({ lastName: "CancelledAfter", status: "cancelled", items: [charged] }),
    rider({ lastName: "Credited", status: "cancelled", items: [charged, { kind: "credit", amountMinor: 100, payoutId: ID(801) }] }),
  ];

  it("offers as charges only children still booked, paid and not yet paid for, with this provider", () => {
    expect(chargeableRiders(riders, PROVIDER).map((r) => r.lastName)).toEqual(["Owed"]);
  });

  it("offers as credits only children cancelled after the provider was paid, and not yet credited", () => {
    expect(creditableRiders(riders, PROVIDER).map((r) => r.lastName)).toEqual(["CancelledAfter"]);
  });

  const form = (extra: Array<[string, string]>) => [
    ["providerId", PROVIDER],
    ["paidOn", "2026-10-18"],
    ["bankReference", "  FNB 123  "],
    ["note", ""],
    ...extra,
  ] as Array<[string, string]>;

  it("reads ticked children and typed credits into the function's arguments", () => {
    const p = parsePayoutForm(form([["charge", ID(1)], ["charge", ID(2)], [`credit:${ID(3)}`, "1,000.50"], [`credit:${ID(4)}`, ""]]));
    expect(p).toEqual({
      providerId: PROVIDER,
      paidOn: "2026-10-18",
      bankReference: "FNB 123",
      note: null,
      chargeRiderIds: [ID(1), ID(2)],
      credits: [{ rider_id: ID(3), amount_minor: 100050 }],
    });
  });

  it("refuses a form with no child ticked, a child ticked twice, or a credit that is not an amount", () => {
    expect(() => parsePayoutForm(form([]))).toThrow(/at least one child/);
    expect(() => parsePayoutForm(form([["charge", ID(1)], ["charge", ID(1)]]))).toThrow(/ticked twice/);
    expect(() => parsePayoutForm(form([["charge", ID(1)], [`credit:${ID(3)}`, "lots"]]))).toThrow(/not an amount/);
    expect(() => parsePayoutForm(form([["charge", ID(1)], [`credit:${ID(3)}`, "0"]]))).toThrow(/not an amount/);
    expect(() => parsePayoutForm(form([["charge", "not-an-id"]]))).toThrow();
  });

  it("writes a statement whose amounts add up, with a credit as a negative line", () => {
    const owed = statementLines(riders, PROVIDER);
    const credit = { kind: "credit" as const, rider: riders[5], amountMinor: 100000 };
    const [lines] = payoutSheets([...owed, credit], periods, [["Provider", "Watermark Tours"]]);
    expect(lines.rows.map((r) => r.at(-1))).toEqual([3726.43, -1000, 2726.43]);
    expect(lines.rows.at(-1)?.[0]).toBe("Total");
  });

  it("is named for the provider, the kind of file, the day and the bank reference", () => {
    expect(payoutFilename("watermark", "remittance", "2026-10-18", "FNB 123/A")).toBe("watermark-remittance-2026-10-18-fnb-123-a.xlsx");
    expect(payoutFilename("watermark", "statement", "2026-10-18")).toBe("watermark-statement-2026-10-18.xlsx");
  });
});

describe("the earnings workbook", () => {
  const riders = [
    rider({ position: 1, items: [{ kind: "charge", amountMinor: 372643, payoutId: ID(800) }] }),
    rider({ position: 2 }),
    rider({ position: 3, school: "Block 7", schoolSort: 7, amountMinor: 440000, providerAmountMinor: 382493, household: "different_schools", booking: { periodId: "t1m1" } }),
    rider({ position: 4, booking: { status: "awaiting_payment", paidAt: null } }),
  ];
  const meta = {
    periodLabel: "Term 1, 2027",
    schools: ["Broadhurst", "Block 7"],
    takenAt: "18 Oct 2026, 09:00",
    takenBy: "Finance",
    awaiting: { bookings: 1, amountMinor: 425000 },
    payouts: new Map([[ID(800), { paid_on: "2026-12-05", bank_reference: "FNB123" }]]),
  };

  it("adds up to the worked example and names lines by reference and place, never by child", () => {
    const sheets = earningsSheets(riders, periods, meta);
    const summary = Object.fromEntries(sheets[0].rows.map(([k, v]) => [k, v]));
    expect(summary["Paid by parents"]).toBe(12900);
    expect(summary["The provider's share"]).toBe(11277.79);
    expect(summary["Hibiscus keeps"]).toBe(1622.21);
    expect(summary["Paid to the provider"]).toBe(3726.43);
    expect(summary["Still owed to the provider"]).toBe(7551.36);

    const lines = sheets[3];
    expect(lines.headers).not.toContain("Child first name");
    expect(lines.rows.map((r) => r[1])).toEqual(["Child 1", "Child 2", "Child 3"]);
    expect(lines.rows[0].at(-2)).toBe("2026-12-05 FNB123");
    expect(JSON.stringify(sheets)).not.toContain("Neo");
  });

  it("totals by school and by period, and says what is awaiting payment", () => {
    const sheets = earningsSheets(riders, periods, meta);
    expect(sheets[1].rows.map((r) => [r[0], r[2], r[4]])).toEqual([
      ["Broadhurst", 2, 8500],
      ["Block 7", 1, 4400],
    ]);
    expect(sheets[2].rows.map((r) => r[0])).toEqual(["Term 1, 2027", "January 2027"]);
    const about = Object.fromEntries(sheets[4].rows.map(([k, v]) => [k, v]));
    expect(about["Not counted"]).toMatch(/1 booking is awaiting payment \(P 4,250\.00\)/);
    expect(() => buildWorkbook(sheets)).not.toThrow();
  });
});
