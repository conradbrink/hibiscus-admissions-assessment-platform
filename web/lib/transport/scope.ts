import "server-only";
import { ATTEMPT_STATUSES, recentAttemptsSince } from "@/lib/payments/attempts";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { Json, PaymentRequestRow, PaymentRow, TransportBookingRiderRow, TransportBookingRow } from "@/lib/supabase/types";
import { bookingRpcArgs, type TransportBookingInput } from "@/lib/transport/form";
import { openTransportRequest } from "@/lib/transport/requests";
import type { TransportSession } from "@/lib/tokens/session";

/**
 * The only door onto a transport booking from the parent's side.
 *
 * Parents are not database principals, and the person holding this session
 * filled in an anonymous form a few minutes ago, so there is no RLS behind
 * these reads and nothing about the browser is trusted. Every function takes
 * the verified session and scopes by the booking it names; the one that does
 * not (`transportAttemptByProviderRef`, for PayGate's cookieless return post)
 * only ever returns a payment to be verified with the gateway, never data to
 * show. `scope.test.ts` fails the build if a page under `app/(parent)/transport`
 * queries a table itself — the same rule `lib/family/scope.ts` keeps.
 */

export function transportClient(): AdminClient {
  return createAdminClient();
}

export class TransportBookingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TransportBookingError";
  }
}

/**
 * Create the booking and the request it will be paid against. The booking
 * function checks and prices everything; this only hands it the form.
 */
export async function startTransportBooking(
  admin: AdminClient,
  input: TransportBookingInput,
  context: { ipHash: string | null; userAgent: string | null }
): Promise<string> {
  const args = bookingRpcArgs(input, context);
  const { data: bookingId, error } = await admin.rpc("create_transport_booking", {
    p_booking: args.p_booking as unknown as Json,
    p_riders: args.p_riders as unknown as Json,
  });
  if (error || !bookingId) throw new TransportBookingError(error?.message ?? "transport_booking_failed");
  try {
    await openTransportRequest(admin, { bookingId });
  } catch (e) {
    // The parent is told it did not work and books again, so this one must
    // not sit on the staff list looking live: nobody holds its session and
    // there is nothing to pay it against.
    await admin.from("transport_bookings").update({ status: "abandoned" }).eq("id", bookingId).eq("status", "awaiting_payment");
    throw e;
  }
  return bookingId;
}

export type SessionRider = TransportBookingRiderRow & { campus: { name: string } | null; grade: { name: string } | null };

export type SessionBooking = {
  booking: TransportBookingRow;
  period: { label: string; kind: "term" | "month"; starts_on: string; ends_on: string } | null;
  area: { name: string } | null;
  riders: SessionRider[];
  /** The open request, else the latest, so a paid booking still shows what was paid. */
  request: PaymentRequestRow | null;
  /** The latest attempts, newest first: what the payment page lists. */
  payments: PaymentRow[];
  /** The latest payment that succeeded, however many attempts came after it: what the receipt is for. */
  paid: PaymentRow | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadSessionBooking(admin: AdminClient, session: TransportSession): Promise<SessionBooking | null> {
  return loadTransportBooking(admin, session.bookingId);
}

/**
 * The same, by id, for the service's own jobs (the paid email) — never for a
 * page, which goes through `loadSessionBooking` and the session.
 */
export async function loadTransportBooking(admin: AdminClient, bookingId: string): Promise<SessionBooking | null> {
  const { data: booking, error } = await admin
    .from("transport_bookings")
    .select("*, transport_periods!transport_bookings_period_id_fkey(label, kind, starts_on, ends_on), transport_areas!transport_bookings_area_id_fkey(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) return null;
  const { transport_periods, transport_areas, ...row } = booking;

  const [ridersRes, requestsRes, paymentsRes, paidRes] = await Promise.all([
    admin
      .from("transport_booking_riders")
      .select("*, campuses!transport_booking_riders_campus_id_fkey(name), grades!transport_booking_riders_grade_id_fkey(name)")
      .eq("booking_id", bookingId)
      .order("position"),
    admin
      .from("payment_requests")
      .select("*")
      .eq("transport_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("payments")
      .select("*")
      .eq("transport_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("payments")
      .select("*")
      .eq("transport_booking_id", bookingId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const r of [ridersRes, requestsRes, paymentsRes, paidRes]) if (r.error) throw new Error(r.error.message);

  const requests = requestsRes.data ?? [];
  const open = requests.find((r) => ["required", "processing", "failed", "partially_paid"].includes(r.status));
  return {
    booking: row as TransportBookingRow,
    period: one(transport_periods),
    area: one(transport_areas),
    riders: (ridersRes.data ?? []).map((r) => {
      const { campuses, grades, ...rider } = r;
      return { ...(rider as TransportBookingRiderRow), campus: one(campuses), grade: one(grades) };
    }),
    request: open ?? requests[0] ?? null,
    payments: paymentsRes.data ?? [],
    paid: paidRes.data ?? null,
  };
}

/** Recent online attempts on this booking, newest first, for the return page and Check again. */
export async function loadTransportAttempts(admin: AdminClient, session: TransportSession): Promise<PaymentRow[]> {
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("transport_booking_id", session.bookingId)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .not("provider_ref", "is", null)
    .gte("created_at", recentAttemptsSince())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The processing payment the PayGate bridge was handed, if it is this booking's. */
export async function processingAttemptForSession(
  admin: AdminClient,
  session: TransportSession,
  providerRef: string
): Promise<PaymentRow | null> {
  if (!providerRef) return null;
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("transport_booking_id", session.bookingId)
    .eq("provider_ref", providerRef)
    .eq("method", "online")
    .eq("status", "processing")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** This booking's latest processing payment on the development gateway. */
export async function latestDevAttemptForSession(admin: AdminClient, session: TransportSession): Promise<PaymentRow | null> {
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("transport_booking_id", session.bookingId)
    .eq("provider", "dev")
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * For PayGate's return, a cross-site POST that arrives without the cookie: the
 * posted request id is all there is. Only a transport attempt matches, and
 * the caller only asks the gateway about it — the verdict is the gateway's,
 * and nothing about the booking is shown on the strength of it.
 */
export async function transportAttemptByProviderRef(admin: AdminClient, providerRef: string): Promise<PaymentRow | null> {
  if (!providerRef) return null;
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("provider_ref", providerRef)
    .not("transport_booking_id", "is", null)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
