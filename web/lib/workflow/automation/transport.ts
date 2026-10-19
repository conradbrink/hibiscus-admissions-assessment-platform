import "server-only";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import { unpaidExpiryDue } from "@/lib/transport/lifecycle";
import { finishInterruptedTransportSettlement } from "@/lib/transport/settle";

/**
 * Unpaid transport bookings expire.
 *
 * A booking holds no seat on its own, but it does hold an open payment
 * request, and the payment page keeps offering to pay it. After the unpaid
 * window (`transport_unpaid_hours`), or at the pay-by date the parent was
 * shown if that comes first, the booking is marked expired and its request
 * cancelled, so the parent is told to book again rather than paying for a
 * period whose booking may have closed. Money that arrives later still
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

/**
 * A booking still awaiting payment with a succeeded payment on it was paid,
 * and its settlement stopped part way. Finished here, before anything could
 * expire it. Given a few minutes first, so a settlement still running is
 * left to finish on its own.
 */
const SETTLEMENT_GRACE_MINUTES = 5;

async function finishInterruptedSettlements(admin: AdminClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_GRACE_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("payments")
    .select("transport_booking_id, transport_bookings!payments_transport_booking_id_fkey!inner(status)")
    .eq("status", "succeeded")
    .eq("transport_bookings.status", "awaiting_payment")
    .lt("updated_at", cutoff)
    .limit(50);
  if (error) {
    console.error("[transport] could not look for unfinished settlements", error.message);
    return;
  }
  for (const id of new Set((data ?? []).map((p) => p.transport_booking_id).filter((v): v is string => v !== null))) {
    try {
      if (await finishInterruptedTransportSettlement(admin, id)) console.warn("[transport] finished an interrupted settlement", id);
    } catch (e) {
      console.error("[transport] could not finish a settlement", id, (e as Error).message);
    }
  }
}

const EXPIRY_SELECT = "id, status, created_at, payments!payments_transport_booking_id_fkey(status), payment_requests!payment_requests_transport_booking_id_fkey(status, due_at)";

export async function expireUnpaidTransportBookings(admin: AdminClient, now: Date = new Date()): Promise<number> {
  await closeStalePendingPayments(admin, now);
  await finishInterruptedSettlements(admin, now);
  const settings = await getSettings(admin);
  const cutoff = new Date(now.getTime() - settings.transportUnpaidHours * 3_600_000).toISOString();
  // Past the window, and past the pay-by date: two reads, because the second
  // is a date on the request rather than on the booking.
  const [byAge, byDueDate] = await Promise.all([
    admin.from("transport_bookings").select(EXPIRY_SELECT).eq("status", "awaiting_payment").lt("created_at", cutoff).limit(100),
    admin
      .from("transport_bookings")
      .select(`${EXPIRY_SELECT}, due:payment_requests!payment_requests_transport_booking_id_fkey!inner(id)`)
      .eq("status", "awaiting_payment")
      .in("due.status", ["required", "failed"])
      .lt("due.due_at", now.toISOString())
      .limit(100),
  ]);
  for (const r of [byAge, byDueDate]) if (r.error) throw new Error(r.error.message);
  const rows = new Map([...(byAge.data ?? []), ...(byDueDate.data ?? [])].map((b) => [b.id, b]));

  const due = unpaidExpiryDue(
    [...rows.values()].map((b) => ({
      id: b.id,
      status: b.status,
      created_at: b.created_at,
      // Or one that succeeded: money reached this booking, so the settlement
      // decides (or, for a part payment, the person its task is for), not the
      // clock.
      has_live_payment: (b.payments ?? []).some((p) => p.status === "pending" || p.status === "processing" || p.status === "succeeded"),
      due_at: (b.payment_requests ?? []).find((r) => r.status === "required" || r.status === "failed")?.due_at ?? null,
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
