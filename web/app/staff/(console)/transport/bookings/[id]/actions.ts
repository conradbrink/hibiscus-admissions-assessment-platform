"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { parseMoneyToMinor } from "@/lib/money";
import { can, closesTransportTasks } from "@/lib/permissions";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { staffTransportError } from "@/lib/transport/staff-errors";
import { enqueueJobs } from "@/lib/workflow/engine";

/**
 * Cancelling children's transport and recording refunds. Both run under the
 * staff member's own client through the database's functions, which decide
 * who may and when: `transport_cancel_riders` (`transport.manage`, every
 * child on the booking at a school the person covers) and
 * `transport_record_refund` (`transport.finance` and `finance.write`). The
 * service role is used afterwards only to queue the parent's email and file a
 * task, which no staff member writes directly.
 */

const cancelSchema = z.object({
  bookingId: z.guid(),
  reason: z.string().trim().min(3, "Say why, in a few words.").max(500, "Keep the reason to 500 characters."),
});

export async function cancelTransportChildren(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("transport.manage");
    const { bookingId, reason } = cancelSchema.parse({ bookingId: formData.get("bookingId"), reason: formData.get("reason") ?? "" });
    const whole = formData.get("whole") === "1";
    const notify = formData.get("notify") === "1";

    const { data: booking, error: bErr } = await ctx.supabase
      .from("transport_bookings")
      .select("id, reference, status, transport_booking_riders!transport_booking_riders_booking_id_fkey(id, position, status, campus_id)")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!booking) throw new Error("That booking could not be found.");
    const booked = (booking.transport_booking_riders ?? []).filter((r) => r.status === "booked");

    // A whole booking is every child still booked, named explicitly, so the
    // email lists exactly the children this cancelled. The function refuses
    // if any child is at a school this person cannot see, so "every child
    // they can see" is every child.
    const chosen = whole ? booked.map((r) => r.id) : formData.getAll("rider").map((v) => z.guid().parse(v));
    if (!chosen.length) throw new Error("Tick the children whose transport you are cancelling.");

    const { error } = await ctx.supabase.rpc("transport_cancel_riders", { p_booking_id: bookingId, p_rider_ids: chosen, p_reason: reason });
    if (error) throw new Error(staffTransportError(error.message));

    try {
      await afterCancelling({ bookingId, reference: booking.reference, wasPaid: booking.status === "paid", riders: booking.transport_booking_riders ?? [], chosen, notify, staffId: ctx.userId });
    } catch (e) {
      // The cancellation stands; pressing the button again would only be refused.
      throw new Error(`The children were cancelled, but the follow-up could not be queued: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      revalidatePath(`/staff/transport/bookings/${bookingId}`);
      revalidatePath("/staff/transport");
    }
  });
}

async function afterCancelling(opts: {
  bookingId: string;
  reference: string;
  wasPaid: boolean;
  riders: Array<{ id: string; position: number; campus_id: string }>;
  chosen: string[];
  notify: boolean;
  staffId: string;
}): Promise<void> {
  const { bookingId, chosen } = opts;
  const admin = createAdminClient();
  const key = createHash("sha256").update([...chosen].sort().join(",")).digest("hex").slice(0, 24);
  if (opts.notify) {
    await enqueueJobs(admin, [
      {
        type: "send_transport_email",
        payload: { transport_booking_id: bookingId, template_key: "transport_cancelled", rider_ids: chosen },
        idempotencyKey: `transport_cancelled:${bookingId}:${key}`,
        applicationId: null,
      },
    ]);
  }
  if (opts.wasPaid) {
    // Money came in for these children. Finance decides the refund, and
    // whether the provider credits anything it was already paid; the task
    // names the booking, not the child, like every transport task.
    const first = [...opts.riders].sort((a, b) => a.position - b.position)[0];
    const n = chosen.length;
    const { error } = await admin.from("tasks").insert({
      transport_booking_id: bookingId,
      campus_id: first?.campus_id ?? null,
      type: "transport_refund_review",
      title: `${opts.reference}: ${n} child${n === 1 ? "" : "ren"} cancelled after payment`,
      details:
        "Decide the refund. Make it in the payment gateway's portal or at the bank, then record it on the booking. " +
        "If the provider was already paid for a child, agree any credit and take it on the next payout.",
      priority: "normal",
      created_by_type: "staff",
      created_by: opts.staffId,
    });
    if (error) throw new Error(error.message);
  }
}

const refundSchema = z.object({
  bookingId: z.guid(),
  riderId: z.guid(),
  amount: z.string().trim().min(1, "Enter the amount that was refunded."),
  note: z.string().trim().min(3, "Say how it was refunded: the portal's reference, or the bank's.").max(500, "Keep the note to 500 characters."),
});

export async function recordTransportRefund(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("transport.finance");
    // The function asks for both; saying so here beats its bare refusal.
    if (!can(ctx.permissions, "finance.write")) throw new Error("Recording a refund needs permission to record payments.");
    const p = refundSchema.parse(Object.fromEntries(formData));
    const amount = parseMoneyToMinor(p.amount);
    if (amount === null || amount <= 0) throw new Error(`"${p.amount}" is not an amount. Enter it in pula, like 1,250.00.`);
    const { error } = await ctx.supabase.rpc("transport_record_refund", { p_rider_id: p.riderId, p_amount_minor: amount, p_note: p.note });
    if (error) throw new Error(staffTransportError(error.message));
    revalidatePath(`/staff/transport/bookings/${p.bookingId}`);
  });
}

/**
 * Close a task about this booking: the refund decided, the double payment
 * sent back. Here because a coordinator cannot open the Tasks page. The
 * staff member's own client writes it, so `tasks_update` decides as it does
 * there, campus included.
 */
export async function closeTransportTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("transport.read");
    if (!closesTransportTasks(ctx.permissions)) throw new Error("You do not have permission to do that.");
    const { bookingId, taskId } = z.object({ bookingId: z.guid(), taskId: z.guid() }).parse(Object.fromEntries(formData));

    const { data, error } = await ctx.supabase
      .from("tasks")
      .update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
      .eq("id", taskId)
      .eq("transport_booking_id", bookingId)
      .eq("status", "open")
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("That task is already closed. Reload the page.");
    revalidatePath(`/staff/transport/bookings/${bookingId}`);
    revalidatePath("/staff/transport");
    revalidatePath("/staff/tasks");
  });
}
