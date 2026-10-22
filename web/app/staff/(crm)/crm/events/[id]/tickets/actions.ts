"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { normaliseTicketNumber, parseSalesForm } from "@/lib/events/sales-form";
import { queueTicketsEmail } from "@/lib/events/settle";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Selling tickets for an event, from the console.
 *
 * Every write goes through the signed-in person's own client, so the event
 * must be one their campus may see (`event_sales` policies read the event's)
 * and a ticket one at their campus. The counter that numbers tickets, the
 * orders and the money are out of reach by grant; this page only sets prices
 * and switches, lets people in at the gate, and sends tickets again.
 */

const path = (eventId: string) => `/staff/crm/events/${eventId}/tickets`;

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function saveSales(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const form = fields(formData);
    const eventId = z.guid().parse(form.eventId);
    const parsed = parseSalesForm(form);
    if (!parsed.ok) throw new Error(parsed.error);

    const { data: existing } = await ctx.supabase.from("event_sales").select("event_id").eq("event_id", eventId).maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from("event_sales").update(parsed.value).eq("event_id", eventId)
      : await ctx.supabase.from("event_sales").insert({ event_id: eventId, ...parsed.value });
    if (error) {
      if (error.code === "23505") throw new Error("Another event already uses that web address. Choose a different one.");
      if (/must belong to a campus/.test(error.message)) throw new Error("Choose a campus for the event first: the campus decides the currency and who sees the money.");
      throw new Error(error.message);
    }
    await recordCrmAudit(createAdminClient(), ctx.actor, {
      action: existing ? "event.sales_updated" : "event.sales_created",
      entityType: "event",
      entityId: eventId,
      after: { ...parsed.value, intro: undefined, stall_intro: undefined },
    });
    revalidatePath(path(eventId));
  });
}

export type CheckInState = {
  tone?: "ok" | "warn" | "error";
  message?: string;
  detail?: string;
};

/**
 * Letting somebody in. A number checks in once: the second time it is shown
 * with when it was first used, so a copied ticket is caught at the gate.
 */
export async function checkInTicket(_: CheckInState, formData: FormData): Promise<CheckInState> {
  let ctx;
  try {
    ctx = await requireStaffAction("crm.write");
  } catch {
    return { tone: "error", message: "You do not have permission to check people in." };
  }
  const eventId = z.guid().safeParse(formData.get("eventId"));
  const number = normaliseTicketNumber(String(formData.get("number") ?? ""));
  if (!eventId.success || !number) return { tone: "error", message: "Type or scan a ticket number." };

  const { data: ticket, error } = await ctx.supabase
    .from("event_tickets")
    .select("id, number, label, holder_first_name, holder_last_name, checked_in_at, order_id")
    .eq("event_id", eventId.data)
    .eq("number", number)
    .maybeSingle();
  if (error) return { tone: "error", message: error.message };
  if (!ticket) return { tone: "error", message: `${number} is not a ticket for this event.`, detail: "Check the number with the person. Do not let them in on this number." };

  const who = `${ticket.holder_first_name} ${ticket.holder_last_name}`;
  if (ticket.checked_in_at) {
    return {
      tone: "warn",
      message: `${number} was already used.`,
      detail: `${who} (${ticket.label}) came in at ${new Date(ticket.checked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Gaborone" })}. Ask for their name before letting anybody in on it.`,
    };
  }
  const { data: done, error: uErr } = await ctx.supabase
    .from("event_tickets")
    .update({ checked_in_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .is("checked_in_at", null)
    .select("id");
  if (uErr) return { tone: "error", message: uErr.message };
  if (!done?.length) return { tone: "warn", message: `${number} was used a moment ago.`, detail: "Somebody else at the gate has just checked it in." };
  revalidatePath(path(eventId.data));
  return { tone: "ok", message: `Let in: ${who}`, detail: `${ticket.label} · ${number}` };
}

export async function undoCheckIn(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ eventId: z.guid(), ticketId: z.guid() }).parse(fields(formData));
    const { error } = await ctx.supabase.from("event_tickets").update({ checked_in_at: null }).eq("id", p.ticketId).eq("event_id", p.eventId);
    if (error) throw new Error(error.message);
    revalidatePath(path(p.eventId));
  });
}

/** The buyer lost the email: a fresh one, with a fresh link, to the address they gave. */
export async function resendTickets(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ eventId: z.guid(), orderId: z.guid() }).parse(fields(formData));
    // Read through RLS first: an order at another campus is "not found".
    const { data: order } = await ctx.supabase.from("event_orders").select("id, status, reference").eq("id", p.orderId).eq("event_id", p.eventId).maybeSingle();
    if (!order) throw new Error("That order is not one you can see.");
    if (order.status !== "paid") throw new Error("Only a paid order has tickets to send.");
    const admin = createAdminClient();
    await queueTicketsEmail(admin, order.id, `event_tickets:${order.id}:again:${Date.now()}`);
    await recordCrmAudit(admin, ctx.actor, { action: "event.tickets_resent", entityType: "event", entityId: p.eventId, after: { order_id: order.id, reference: order.reference } });
    drainSoon();
    revalidatePath(path(p.eventId));
  });
}
