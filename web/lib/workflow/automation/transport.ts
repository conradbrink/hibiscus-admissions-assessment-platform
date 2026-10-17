import "server-only";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import { unpaidExpiryDue } from "@/lib/transport/lifecycle";

/**
 * Unpaid transport bookings expire.
 *
 * A booking holds no seat on its own, but it does hold an open payment
 * request, and the payment page keeps offering to pay it. After the unpaid
 * window (`transport_unpaid_hours`) the booking is marked expired and its
 * request cancelled, so the parent is told to book again rather than paying
 * for a period whose booking may have closed. Money that arrives later still
 * settles: the guard lets an expired booking become paid, and the settlement
 * says so (`lib/transport/settle.ts`).
 *
 * Runs from the drain every few minutes; each step is idempotent.
 */
/**
 * A payment row is `pending` only for the moment between its insert and the
 * gateway's answer (`startCheckout`). One older than this never reached the
 * gateway: the request died in between. Left alone it counts as a payment in
 * flight for ever, and the booking could then never expire, be cancelled or
 * have its people removed. Nobody can have paid against it, so it is closed.
 */
const STALE_PENDING_MINUTES = 30;

async function closeStalePendingPayments(admin: AdminClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_PENDING_MINUTES * 60_000).toISOString();
  const { error } = await admin
    .from("payments")
    .update({ status: "failed", failure_reason: "never reached the payment gateway" })
    .not("transport_booking_id", "is", null)
    .eq("status", "pending")
    .lt("created_at", cutoff);
  if (error) console.error("[transport] could not close stale pending payments", error.message);
}

export async function expireUnpaidTransportBookings(admin: AdminClient, now: Date = new Date()): Promise<number> {
  await closeStalePendingPayments(admin, now);
  const settings = await getSettings(admin);
  const cutoff = new Date(now.getTime() - settings.transportUnpaidHours * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("transport_bookings")
    .select("id, status, created_at, payments!payments_transport_booking_id_fkey(status)")
    .eq("status", "awaiting_payment")
    .lt("created_at", cutoff)
    .limit(100);
  if (error) throw new Error(error.message);

  const due = unpaidExpiryDue(
    (data ?? []).map((b) => ({
      id: b.id,
      status: b.status,
      created_at: b.created_at,
      has_payment_in_flight: (b.payments ?? []).some((p) => p.status === "pending" || p.status === "processing"),
    })),
    settings.transportUnpaidHours,
    now
  );

  let expired = 0;
  for (const id of due) {
    const { data: changed, error: uErr } = await admin
      .from("transport_bookings")
      .update({ status: "expired" })
      .eq("id", id)
      .eq("status", "awaiting_payment")
      .select("id");
    if (uErr) {
      console.error("[transport] could not expire a booking", id, uErr.message);
      continue;
    }
    if (!changed?.length) continue;
    await admin.from("payment_requests").update({ status: "cancelled" }).eq("transport_booking_id", id).in("status", ["required", "failed"]);
    expired += 1;
  }
  return expired;
}
