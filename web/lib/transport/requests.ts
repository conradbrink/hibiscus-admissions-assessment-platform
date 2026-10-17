import "server-only";
import { endOfSchoolDay } from "@/lib/format-date";
import { OPEN_REQUEST_STATUSES } from "@/lib/payments/requests";
import { subjectColumns } from "@/lib/payments/subject";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, PaymentRequestRow } from "@/lib/supabase/types";
import { SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * What a transport booking owes, as a payment request.
 *
 * Raised from the children's own rows, which the booking function priced and
 * froze: the request copies their amounts, it never works anything out. One
 * request is open per booking at a time (`payment_requests_one_open_transport_idx`),
 * and a parent who presses Pay twice arrives at the same one.
 */

export async function loadOpenTransportRequest(admin: AdminClient, bookingId: string): Promise<PaymentRequestRow | null> {
  const { data, error } = await admin
    .from("payment_requests")
    .select("*")
    .eq("transport_booking_id", bookingId)
    .in("status", [...OPEN_REQUEST_STATUSES])
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

export async function openTransportRequest(
  admin: AdminClient,
  opts: { bookingId: string; now?: Date }
): Promise<PaymentRequestRow> {
  const existing = await loadOpenTransportRequest(admin, opts.bookingId);
  if (existing) return existing;

  const { data: booking, error: bErr } = await admin
    .from("transport_bookings")
    .select("id, status, transport_periods!transport_bookings_period_id_fkey(booking_closes_on)")
    .eq("id", opts.bookingId)
    .single();
  if (bErr || !booking) throw new WorkflowError(bErr?.message ?? "transport booking missing", "database");
  if (booking.status !== "awaiting_payment") {
    throw new WorkflowError("This booking is not waiting for a payment.", "status_conflict");
  }

  const { data: riders, error: rErr } = await admin
    .from("transport_booking_riders")
    .select("position, first_name, last_name, service, mon, tue, wed, thu, fri, amount_minor")
    .eq("booking_id", opts.bookingId)
    .eq("status", "booked")
    .order("position");
  if (rErr) throw new WorkflowError(rErr.message, "database");
  const lines = (riders ?? []).map((r) => ({
    code: `child_${r.position}`,
    label: `${r.first_name} ${r.last_name}: ${SERVICE_LABELS[r.service].toLowerCase()}, ${weekdaysLabel(r)}`,
    amount_minor: Number(r.amount_minor),
  }));
  const total = lines.reduce((sum, l) => sum + l.amount_minor, 0);
  if (total <= 0) throw new WorkflowError("There is nothing on this booking to pay for.", "status_conflict");

  // Due when booking closes for the period, or when an unpaid booking expires,
  // whichever comes first: the request should never outlive the place.
  const now = opts.now ?? new Date();
  const settings = await getSettings(admin);
  const expires = new Date(now.getTime() + settings.transportUnpaidHours * 3_600_000);
  const period = Array.isArray(booking.transport_periods) ? booking.transport_periods[0] : booking.transport_periods;
  const closes = period?.booking_closes_on ? endOfSchoolDay(period.booking_closes_on) : expires;
  const dueAt = closes < expires ? closes : expires;

  const { data: request, error } = await admin
    .from("payment_requests")
    .insert({
      ...subjectColumns({ kind: "transport", transportBookingId: opts.bookingId }),
      currency: "BWP",
      amount_minor: total,
      lines: lines as unknown as Json,
      due_at: dueAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !request) throw new WorkflowError(error?.message ?? "transport payment request insert failed", "database");
  return request;
}
