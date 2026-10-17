import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TransportBookingStatus, TransportPeriodRow, TransportProviderRow } from "@/lib/supabase/types";
import { toStaffRider, type RiderSelectRow, type StaffRider } from "@/lib/transport/staff-rider";

/**
 * The staff side's reads of school transport. Every one takes the staff
 * member's own client, never the service role: the policies decide what a
 * person sees — `transport.read` at the children's own schools, and payout
 * items only with `transport.finance` — so a list, a report and a download
 * hold exactly what the screen does.
 */

type StaffClient = SupabaseClient<Database>;

/** PostgREST's default most rows per read. */
const PAGE = 1000;
/**
 * A school shuttle carries hundreds of children a term, not tens of
 * thousands. A read that reaches this is wrong, and stopping says so rather
 * than handing over a list cut short.
 */
const CAP = 20000;

const RIDER_SELECT =
  "id, booking_id, position, first_name, last_name, campus_id, service, mon, tue, wed, thu, fri, days_count, household, amount_minor, provider_amount_minor, refund_minor, status, cancelled_at, notes, campuses!transport_booking_riders_campus_id_fkey(name, sort_order), grades!transport_booking_riders_grade_id_fkey(name, sort_order), transport_bookings!transport_booking_riders_booking_id_fkey!inner(reference, status, paid_at, anonymised_at, period_id, provider_id, parent_first_name, parent_last_name, mobile, second_contact_name, second_contact_mobile, address_line, landmark, notes, transport_areas!transport_bookings_area_id_fkey(name, sort_order), transport_zones!transport_bookings_zone_id_fkey(label, sort_order)), transport_payout_items(kind, amount_minor, payout_id)";

export type RiderFilter = {
  periodIds?: readonly string[];
  bookingIds?: readonly string[];
  riderIds?: readonly string[];
  /** Only bookings the parent paid, whatever happened after. */
  paidOnly?: boolean;
  bookingStatuses?: readonly TransportBookingStatus[];
};

/**
 * Children's lines with their booking and payout items, every page of them.
 * Pages follow the id rather than an offset, so a booking made while the
 * download runs cannot push a row from one page to the next and take it twice.
 */
/**
 * Ids go in the query string, and a payout for a whole term names hundreds of
 * children: past a few kilobytes the gateway in front of the API refuses the
 * URL. A long list is read in slices and the slices put together.
 */
const IDS_PER_READ = 100;

export async function loadStaffRiders(supabase: StaffClient, filter: RiderFilter): Promise<StaffRider[]> {
  if (filter.periodIds?.length === 0 || filter.bookingIds?.length === 0 || filter.riderIds?.length === 0) return [];
  for (const key of ["riderIds", "bookingIds"] as const) {
    const ids = filter[key];
    if (ids && ids.length > IDS_PER_READ) {
      const parts: StaffRider[][] = [];
      for (let i = 0; i < ids.length; i += IDS_PER_READ) {
        parts.push(await loadStaffRiders(supabase, { ...filter, [key]: ids.slice(i, i + IDS_PER_READ) }));
      }
      return parts.flat();
    }
  }
  const out: StaffRider[] = [];
  let after: string | null = null;
  for (;;) {
    let q = supabase.from("transport_booking_riders").select(RIDER_SELECT).order("id").limit(PAGE);
    if (filter.periodIds) q = q.in("transport_bookings.period_id", [...filter.periodIds]);
    if (filter.bookingIds) q = q.in("booking_id", [...filter.bookingIds]);
    if (filter.riderIds) q = q.in("id", [...filter.riderIds]);
    if (filter.paidOnly) q = q.not("transport_bookings.paid_at", "is", null);
    if (filter.bookingStatuses) q = q.in("transport_bookings.status", [...filter.bookingStatuses]);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RiderSelectRow[];
    for (const row of rows) {
      const r = toStaffRider(row);
      if (r) out.push(r);
    }
    if (rows.length < PAGE) break;
    if (out.length >= CAP) throw new Error(`More than ${CAP} children's lines match. Narrow the period.`);
    after = rows[rows.length - 1].id;
  }
  return out;
}

export async function loadPeriods(supabase: StaffClient): Promise<TransportPeriodRow[]> {
  const { data, error } = await supabase.from("transport_periods").select("*").order("starts_on").order("month_index", { nullsFirst: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadProviders(supabase: StaffClient): Promise<TransportProviderRow[]> {
  const { data, error } = await supabase.from("transport_providers").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The Botswana schools this person can see: what their lists and reports cover. */
export async function loadTransportSchools(supabase: StaffClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from("v_accessible_campuses").select("id, name, sort_order").eq("country", "BW").order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}

/** Bookings for these periods still awaiting payment, and what they would bring in. */
export async function loadAwaitingPayment(supabase: StaffClient, periodIds: readonly string[]): Promise<{ bookings: number; amountMinor: number }> {
  const riders = await loadStaffRiders(supabase, { periodIds, bookingStatuses: ["awaiting_payment"] });
  return {
    bookings: new Set(riders.map((r) => r.bookingId)).size,
    amountMinor: riders.filter((r) => r.status === "booked").reduce((s, r) => s + r.amountMinor, 0),
  };
}

/** The payouts the given lines were paid or credited in, by id. */
export async function loadPayoutsFor(supabase: StaffClient, riders: readonly StaffRider[]): Promise<Map<string, { paid_on: string; bank_reference: string }>> {
  const ids = [...new Set(riders.flatMap((r) => r.items.map((i) => i.payoutId)))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("transport_payouts").select("id, paid_on, bank_reference").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, { paid_on: p.paid_on, bank_reference: p.bank_reference }]));
}
