import "server-only";
import { sendEventEmail, type SendTemplatedResult } from "@/lib/email/send";
import { mintOrderLink } from "@/lib/events/orders";
import { eventWhen } from "@/lib/events/pricing";
import { formatMoney } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { EventTicketRow } from "@/lib/supabase/types";

/**
 * The tickets email: what the template `event_tickets` is given.
 *
 * The wording is the template's, edited by staff like every other email. What
 * is built here is the data: the event, the amount, and the list of tickets,
 * one line each, number first, because that is what the gate reads out.
 */

/** "HCS-0001-K7Q · Ticket · Neo Molefe", one per line. Pure. */
export function ticketLines(tickets: Pick<EventTicketRow, "number" | "label" | "holder_first_name" | "holder_last_name">[]): string {
  return tickets.map((t) => `${t.number} · ${t.label} · ${t.holder_first_name} ${t.holder_last_name}`).join("\n");
}

export async function sendEventOrderEmail(
  admin: AdminClient,
  opts: { orderId: string; templateKey: string; idempotencyKey: string }
): Promise<SendTemplatedResult> {
  const { data: order, error } = await admin.from("event_orders").select("*").eq("id", opts.orderId).maybeSingle();
  if (error) return { status: "failed", error: error.message, retryable: true };
  if (!order) return { status: "skipped", reason: "order missing" };
  if (order.anonymised_at) return { status: "skipped", reason: "order anonymised" };
  if (order.status !== "paid") return { status: "skipped", reason: `order is ${order.status}` };

  const [{ data: tickets, error: tErr }, { data: event, error: eErr }, { data: sales, error: sErr }] = await Promise.all([
    admin.from("event_tickets").select("number, label, holder_first_name, holder_last_name").eq("order_id", order.id).order("number"),
    admin.from("crm_events").select("name, starts_at, ends_at, location").eq("id", order.event_id).single(),
    admin.from("event_sales").select("show_time").eq("event_id", order.event_id).single(),
  ]);
  if (tErr || eErr || sErr || !event || !sales) {
    return { status: "failed", error: tErr?.message ?? eErr?.message ?? sErr?.message ?? "event missing", retryable: true };
  }
  // Paid and no tickets would be an email listing nothing. The settle step
  // issues them before queueing this, so a retry will find them.
  if (!tickets?.length) return { status: "failed", error: "no tickets issued yet", retryable: true };

  const link = await mintOrderLink(admin, order.id);
  return sendEventEmail(admin, {
    eventOrderId: order.id,
    to: order.email,
    templateKey: opts.templateKey,
    idempotencyKey: opts.idempotencyKey,
    variables: {
      buyer_first_name: order.buyer_first_name,
      event_name: event.name,
      event_when: eventWhen(event, sales.show_time),
      event_location: event.location ?? "",
      ticket_list: ticketLines(tickets),
      ticket_count: String(tickets.length),
      tickets_link: link,
      order_reference: order.reference,
      amount_paid: formatMoney(Number(order.amount_minor), order.currency),
      stall_name: order.kind === "stall" ? order.business_name : null,
    },
  });
}
