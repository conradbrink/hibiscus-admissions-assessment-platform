import type { TransportBookingStatus, TransportHousehold, TransportRiderService } from "@/lib/supabase/types";
import type { WeekdaySet } from "@/lib/transport/days";
import type { LedgerRider } from "@/lib/transport/ledger";

/**
 * One child's line as the staff screens read it: the rider row, the booking
 * it belongs to and the payout items that name it, flattened from the one
 * embedded select in `lib/transport/staff.ts`.
 *
 * Pure, so the rider list, the ledger and the payout form can be tested on
 * plain objects. The row arrives through the staff member's own client, so a
 * campus-scoped reader only ever has their own schools' children here, and a
 * reader without `transport.finance` has no payout items at all.
 */

export type StaffRider = {
  id: string;
  bookingId: string;
  reference: string;
  position: number;
  firstName: string;
  lastName: string;
  campusId: string;
  school: string;
  schoolSort: number;
  grade: string;
  gradeSort: number;
  service: TransportRiderService;
  days: WeekdaySet;
  daysCount: number;
  household: TransportHousehold;
  amountMinor: number;
  providerAmountMinor: number;
  refundMinor: number;
  status: "booked" | "cancelled";
  cancelledAt: string | null;
  notes: string | null;
  booking: {
    status: TransportBookingStatus;
    paidAt: string | null;
    anonymised: boolean;
    periodId: string;
    providerId: string;
    parentFirstName: string;
    parentLastName: string;
    mobile: string | null;
    secondContactName: string | null;
    secondContactMobile: string | null;
    address: string;
    landmark: string | null;
    notes: string | null;
    area: string;
    areaSort: number;
    zone: string;
    zoneSort: number;
  };
  items: Array<{ kind: "charge" | "credit"; amountMinor: number; payoutId: string }>;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type Named = { name: string; sort_order: number };

/** The shape `RIDER_SELECT` returns, loosely: embeds may come back as an object or a one-element array. */
export type RiderSelectRow = {
  id: string;
  booking_id: string;
  position: number;
  first_name: string;
  last_name: string;
  campus_id: string;
  service: TransportRiderService;
  mon: boolean;
  tue: boolean;
  wed: boolean;
  thu: boolean;
  fri: boolean;
  days_count: number;
  household: TransportHousehold;
  amount_minor: number;
  provider_amount_minor: number;
  refund_minor: number;
  status: "booked" | "cancelled";
  cancelled_at: string | null;
  notes: string | null;
  campuses: Named | Named[] | null;
  grades: Named | Named[] | null;
  transport_bookings:
    | (BookingSelect | BookingSelect[])
    | null;
  transport_payout_items: Array<{ kind: "charge" | "credit"; amount_minor: number; payout_id: string }> | null;
};

type BookingSelect = {
  reference: string;
  status: TransportBookingStatus;
  paid_at: string | null;
  anonymised_at: string | null;
  period_id: string;
  provider_id: string;
  parent_first_name: string;
  parent_last_name: string;
  mobile: string | null;
  second_contact_name: string | null;
  second_contact_mobile: string | null;
  address_line: string;
  landmark: string | null;
  notes: string | null;
  transport_areas: Named | Named[] | null;
  transport_zones: { label: string; sort_order: number } | Array<{ label: string; sort_order: number }> | null;
};

export function toStaffRider(row: RiderSelectRow): StaffRider | null {
  const b = one(row.transport_bookings);
  // The inner join guarantees a booking; a row without one is not a line anybody can act on.
  if (!b) return null;
  const campus = one(row.campuses);
  const grade = one(row.grades);
  const area = one(b.transport_areas);
  const zone = one(b.transport_zones);
  return {
    id: row.id,
    bookingId: row.booking_id,
    reference: b.reference,
    position: row.position,
    firstName: row.first_name,
    lastName: row.last_name,
    campusId: row.campus_id,
    school: campus?.name ?? "School",
    schoolSort: campus?.sort_order ?? 0,
    grade: grade?.name ?? "",
    gradeSort: grade?.sort_order ?? 0,
    service: row.service,
    days: { mon: row.mon, tue: row.tue, wed: row.wed, thu: row.thu, fri: row.fri },
    daysCount: row.days_count,
    household: row.household,
    amountMinor: Number(row.amount_minor),
    providerAmountMinor: Number(row.provider_amount_minor),
    refundMinor: Number(row.refund_minor),
    status: row.status,
    cancelledAt: row.cancelled_at,
    notes: row.notes,
    booking: {
      status: b.status,
      paidAt: b.paid_at,
      anonymised: b.anonymised_at !== null,
      periodId: b.period_id,
      providerId: b.provider_id,
      parentFirstName: b.parent_first_name,
      parentLastName: b.parent_last_name,
      mobile: b.mobile,
      secondContactName: b.second_contact_name,
      secondContactMobile: b.second_contact_mobile,
      address: b.address_line,
      landmark: b.landmark,
      notes: b.notes,
      area: area?.name ?? "",
      areaSort: area?.sort_order ?? 0,
      zone: zone?.label ?? "",
      zoneSort: zone?.sort_order ?? 0,
    },
    items: (row.transport_payout_items ?? []).map((i) => ({ kind: i.kind, amountMinor: Number(i.amount_minor), payoutId: i.payout_id })),
  };
}

export function toLedgerRider(r: StaffRider): LedgerRider {
  return {
    id: r.id,
    bookingId: r.bookingId,
    bookingPaid: r.booking.paidAt !== null,
    status: r.status,
    amountMinor: r.amountMinor,
    providerAmountMinor: r.providerAmountMinor,
    refundMinor: r.refundMinor,
    items: r.items,
  };
}

/**
 * Riding: a child still booked on a booking that is paid. What the provider
 * plans from. An anonymised booking's names read "Removed", which is no use
 * to a driver; its period ended long ago, so this is a backstop.
 */
export function isRiding(r: StaffRider): boolean {
  return r.status === "booked" && r.booking.status === "paid" && !r.booking.anonymised;
}

/** Zone, area, school, then surname and first name: the order a route is planned in. */
export function byRoute(a: StaffRider, b: StaffRider): number {
  return (
    a.booking.zoneSort - b.booking.zoneSort ||
    a.booking.zone.localeCompare(b.booking.zone) ||
    a.booking.areaSort - b.booking.areaSort ||
    a.booking.area.localeCompare(b.booking.area) ||
    a.schoolSort - b.schoolSort ||
    a.school.localeCompare(b.school) ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName) ||
    a.reference.localeCompare(b.reference) ||
    a.position - b.position
  );
}
