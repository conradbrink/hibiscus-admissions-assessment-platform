import type { Sheet } from "@/lib/enrolment/xlsx";
import { toSchoolDateString } from "@/lib/format-date";
import { prettyMobile } from "@/lib/phone";
import { SERVICE_LABELS, WEEKDAYS, type Weekday } from "@/lib/transport/days";
import type { PeriodLike, SeatWindow } from "@/lib/transport/periods";
import { byRoute, isRiding, type StaffRider } from "@/lib/transport/staff-rider";

/**
 * The rider list the transport provider plans its routes from: who to collect,
 * where, on which days, for which school, and whom to call.
 *
 * What it carries is chosen, not everything we hold. The provider gets the
 * child's and the parent's names, the pick-up address and the phone numbers,
 * because a driver needs them. It does not get the parent's email address or
 * any price: those are the school's business, not the route's. `staff-lines.test.ts`
 * fails if a header ever names either.
 *
 * Only children who are still booked on a paid booking are riders. Children
 * cancelled after payment go on their own sheet, so the provider can take
 * them off a route it has already planned. Seats are counted per month
 * (`seatWindows`): a child booked for January and one booked for February
 * never share a seat, and a child booked month by month is one seat a month.
 */

export type RiderListMeta = {
  providerName: string;
  periodLabel: string;
  takenAt: string;
  takenBy: string;
  /** The schools the person taking the list can see; a campus-scoped list says so. */
  schools: readonly string[];
  /** Bookings not yet paid for the same period, not in the list. */
  unpaidBookings: number;
  /** The months (or the one period) the seats are counted over. */
  windows: readonly SeatWindow[];
};

export const RIDER_HEADERS = [
  "Zone",
  "Area",
  "Address",
  "Landmark",
  "Child first name",
  "Child surname",
  "School",
  "Grade",
  "Service",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Parent first name",
  "Parent surname",
  "Mobile",
  "Second contact",
  "Second contact mobile",
  "Booked for",
  "From",
  "To",
  "Booking reference",
  "Notes",
] as const;

export const CANCELLED_HEADERS = ["Booking reference", "Child first name", "Child surname", "School", "Area", "Booked for", "Cancelled on"] as const;

export type DaySlot = `${Weekday}_${"am" | "pm"}`;
export const DAY_SLOTS: readonly DaySlot[] = WEEKDAYS.flatMap((d) => [`${d}_am`, `${d}_pm`] as DaySlot[]);
const SLOT_LABEL = (s: DaySlot) => `${s.slice(0, 1).toUpperCase()}${s.slice(1, 3)} ${s.endsWith("am") ? "AM" : "PM"}`;

export type DayCountRow = { area: string; school: string; children: number; slots: Record<DaySlot, number> };

const emptySlots = (): Record<DaySlot, number> => Object.fromEntries(DAY_SLOTS.map((s) => [s, 0])) as Record<DaySlot, number>;

/**
 * Seats a route needs, by area and school, for each weekday's morning and
 * afternoon run. A full-shuttle child counts in both; morning only counts in
 * the morning.
 */
export function dayCounts(riders: readonly StaffRider[]): { rows: DayCountRow[]; total: DayCountRow } {
  const sorted = riders.filter(isRiding).sort(byRoute);
  const rows = new Map<string, DayCountRow>();
  const total: DayCountRow = { area: "All", school: "All", children: 0, slots: emptySlots() };
  for (const r of sorted) {
    const key = `${r.booking.area}\u0000${r.school}`;
    const row = rows.get(key) ?? { area: r.booking.area, school: r.school, children: 0, slots: emptySlots() };
    row.children += 1;
    total.children += 1;
    for (const d of WEEKDAYS) {
      if (!r.days[d]) continue;
      for (const half of ["am", "pm"] as const) {
        if (r.service !== "full" && r.service !== half) continue;
        row.slots[`${d}_${half}`] += 1;
        total.slots[`${d}_${half}`] += 1;
      }
    }
    rows.set(key, row);
  }
  return { rows: [...rows.values()], total };
}

const mobile = (v: string | null) => (v ? prettyMobile(v) : "");
const joinNotes = (...parts: Array<string | null>) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ");

export function riderRow(r: StaffRider, period: PeriodLike | undefined): string[] {
  return [
    r.booking.zone,
    r.booking.area,
    r.booking.address,
    r.booking.landmark ?? "",
    r.firstName,
    r.lastName,
    r.school,
    r.grade,
    SERVICE_LABELS[r.service],
    ...WEEKDAYS.map((d) => (r.days[d] ? "Yes" : "")),
    r.booking.parentFirstName,
    r.booking.parentLastName,
    mobile(r.booking.mobile),
    r.booking.secondContactName ?? "",
    mobile(r.booking.secondContactMobile),
    period?.label ?? "",
    period?.starts_on ?? "",
    period?.ends_on ?? "",
    r.reference,
    joinNotes(r.notes, r.booking.notes),
  ];
}

/** The seats for each window: its riders are the children booked for any of its periods. */
export function windowCounts(riders: readonly StaffRider[], windows: readonly SeatWindow[]): Array<{ window: SeatWindow; riding: number } & ReturnType<typeof dayCounts>> {
  return windows.map((w) => {
    const inWindow = riders.filter((r) => w.periodIds.includes(r.booking.periodId));
    const counts = dayCounts(inWindow);
    return { window: w, riding: counts.total.children, ...counts };
  });
}

/**
 * Cancelled after the parent paid, so possibly already on a route. A booking
 * cancelled before the money arrived (it can still arrive, late) was never
 * on one.
 */
export function cancelledAfterPayment(r: StaffRider): boolean {
  if (r.status !== "cancelled" || r.booking.paidAt === null || r.booking.anonymised) return false;
  return r.cancelledAt === null || new Date(r.cancelledAt).getTime() >= new Date(r.booking.paidAt).getTime();
}

export function riderListSheets(riders: readonly StaffRider[], periods: ReadonlyMap<string, PeriodLike>, meta: RiderListMeta): Sheet[] {
  const riding = riders.filter(isRiding).sort(byRoute);
  const cancelled = riders.filter(cancelledAfterPayment).sort(byRoute);
  const windows = windowCounts(riding, meta.windows);

  const countRow = (label: string, c: DayCountRow) => [label, c.area, c.school, c.children, ...DAY_SLOTS.map((s) => c.slots[s])];
  const about: string[][] = [
    ["Provider", meta.providerName],
    ["Period", meta.periodLabel],
    [
      "Children riding",
      windows.length === 1 ? String(windows[0].riding) : windows.map((w) => `${w.window.label}: ${w.riding}`).join("; "),
    ],
    ["Schools in this list", meta.schools.join(", ")],
    [
      "Not in this list",
      meta.unpaidBookings
        ? `${meta.unpaidBookings} booking${meta.unpaidBookings === 1 ? " is" : "s are"} not paid yet. A child joins the list when the parent pays.`
        : "Every booking for this period is paid or closed.",
    ],
    ["Months", "A child booked month by month has one row for each month booked. The seats are counted month by month."],
    ["Taken", meta.takenAt],
    ["Taken by", meta.takenBy],
    ["Use", "For planning school transport only. Keep this file safe, share it only with the drivers who need it, and delete it when the period ends."],
  ];

  return [
    {
      name: "Riders",
      headers: [...RIDER_HEADERS],
      rows: riding.map((r) => riderRow(r, periods.get(r.booking.periodId))),
      freezeHeader: true,
      columns: [{ width: 12 }, { width: 18 }, { width: 32 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 12 }, { width: 28 }],
    },
    {
      name: "Counts",
      headers: ["Seats in", "Area", "School", "Children", ...DAY_SLOTS.map(SLOT_LABEL)],
      rows: windows.flatMap((w) => (w.rows.length ? [...w.rows.map((c) => countRow(w.window.label, c)), countRow(w.window.label, w.total)] : [])),
      freezeHeader: true,
      columns: [{ width: 20 }, { width: 18 }, { width: 18 }, { format: "count" }, ...DAY_SLOTS.map(() => ({ format: "count" as const }))],
    },
    {
      name: "Cancelled",
      headers: [...CANCELLED_HEADERS],
      rows: cancelled.map((r) => [
        r.reference,
        r.firstName,
        r.lastName,
        r.school,
        r.booking.area,
        periods.get(r.booking.periodId)?.label ?? "",
        r.cancelledAt ? toSchoolDateString(new Date(r.cancelledAt)) : "",
      ]),
      freezeHeader: true,
    },
    { name: "About this list", headers: ["", ""], rows: about },
  ];
}

/** "watermark-riders-term-1-2027-2026-10-18.xlsx" */
export function riderListFilename(providerCode: string, periodLabel: string, today: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "list";
  return `${slug(providerCode)}-riders-${slug(periodLabel)}-${today}.xlsx`;
}
