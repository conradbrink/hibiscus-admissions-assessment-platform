import "server-only";
import { randomBytes } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { holdersJson, orderRefusal, type Buyer, type Holder } from "@/lib/events/input";
import { formatMoney } from "@/lib/money";
import { ATTEMPT_STATUSES, recentAttemptsSince } from "@/lib/payments/attempts";
import { startCheckout } from "@/lib/payments/checkout";
import { OPEN_REQUEST_STATUSES } from "@/lib/payments/requests";
import { subjectColumns } from "@/lib/payments/subject";
import { hashToken, siteUrl } from "@/lib/tokens";
import type { CrmEventRow, EventOrderRow, EventSalesRow, EventTicketRow, Json, PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * Everything the public event pages read and write, through the service role.
 *
 * A buyer holds no session and is nobody's family, so there is no RLS to run
 * as. What scopes a read instead is the slug of an event that is on sale, or
 * the link to one order: a 256-bit token whose SHA-256 is all we keep, the
 * same rule as every other link here. Pages never query these tables
 * themselves; they come through this module, which always narrows by one of
 * the two.
 */

export type SaleEvent = {
  event: Pick<CrmEventRow, "id" | "name" | "starts_at" | "ends_at" | "location" | "is_cancelled" | "capacity" | "campus_id">;
  sales: EventSalesRow;
  campus: { name: string; currency: "BWP" | "ZAR" };
};

/** An event on sale, by its public address. Null for anything else, so a page can 404. */
export async function loadSaleEvent(admin: AdminClient, slug: string): Promise<SaleEvent | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
  const { data: sales, error } = await admin.from("event_sales").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!sales) return null;
  const { data: event, error: eErr } = await admin
    .from("crm_events")
    .select("id, name, starts_at, ends_at, location, is_cancelled, capacity, campus_id")
    .eq("id", sales.event_id)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);
  if (!event?.campus_id) return null;
  const { data: campus, error: cErr } = await admin.from("campuses").select("name, currency").eq("id", event.campus_id).maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!campus) return null;
  return { event, sales, campus: { name: campus.name, currency: campus.currency as "BWP" | "ZAR" } };
}

// ---------------------------------------------------------------------------
// Taking an order
// ---------------------------------------------------------------------------

/** A fresh link to one order: the raw token goes to the buyer, its hash to `event_order_links`. */
function mintOrderToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The shape every link this module mints has. Anything else is "not found" without a round trip. */
export function isOrderToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function ticketsUrl(token: string): string {
  return `${siteUrl()}/events/tickets/${token}`;
}

export type PlacedOrder = { order: EventOrderRow; token: string };

/**
 * Takes the order: prices it, checks it is open and there is room, and writes
 * it, all inside `create_event_order()`. A refusal comes back as a sentence
 * for the buyer.
 */
export async function placeOrder(
  admin: AdminClient,
  sale: SaleEvent,
  input:
    | { kind: "tickets"; buyer: Buyer; holders: Holder[] }
    | { kind: "stall"; buyer: Buyer; holders: Holder[]; businessName: string; goods: string | null; needsPower: boolean }
): Promise<PlacedOrder> {
  const token = mintOrderToken();
  const { data, error } = await admin.rpc("create_event_order", {
    p_event_id: sale.event.id,
    p_kind: input.kind,
    p_buyer_first_name: input.buyer.firstName,
    p_buyer_last_name: input.buyer.lastName,
    p_email: input.buyer.email,
    p_mobile: input.buyer.mobile,
    p_quantity: input.kind === "tickets" ? input.holders.length : 1,
    p_holders: holdersJson(input.holders) as unknown as Json,
    p_business_name: input.kind === "stall" ? input.businessName : null,
    p_stall_goods: input.kind === "stall" ? input.goods : null,
    p_needs_power: input.kind === "stall" ? input.needsPower : null,
    p_link_hash: hashToken(token),
  });
  if (error) throw new WorkflowError(orderRefusal(error.message), "status_conflict");
  const placed = data?.[0];
  if (!placed) throw new WorkflowError(orderRefusal(""), "database");
  const { data: order, error: oErr } = await admin.from("event_orders").select("*").eq("id", placed.order_id).single();
  if (oErr || !order) throw new WorkflowError(oErr?.message ?? "order missing after insert", "database");
  return { order, token };
}

/** What the order is for, in a line: "3 × Ticket (Early bird)", "Stall: Mpho's Bakes". */
export function orderLineLabel(order: Pick<EventOrderRow, "kind" | "quantity" | "price_name" | "business_name">, ticketLabel: string): string {
  return order.kind === "stall" ? `Stall: ${order.business_name ?? ""}` : `${order.quantity} × ${ticketLabel} (${order.price_name})`;
}

/**
 * Sends the buyer to the gateway for one order.
 *
 * The request copies the order's figures once, as every request does, and
 * names the order as its subject; the payment's subject is copied from it by
 * trigger. If the gateway cannot be reached the order is cancelled at once,
 * so its places are not held for a day by a checkout that never opened.
 */
export async function startOrderCheckout(
  admin: AdminClient,
  sale: SaleEvent,
  order: EventOrderRow,
  backPath: string
): Promise<string> {
  const label = orderLineLabel(order, sale.sales.ticket_label);
  const { data: inserted, error } = await admin
    .from("payment_requests")
    .insert({
      ...subjectColumns({ kind: "event", eventOrderId: order.id }),
      currency: order.currency,
      amount_minor: order.amount_minor,
      lines: [{ code: order.kind, label, amount_minor: order.amount_minor }] as unknown as Json,
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select("*")
    .single();
  if (error || !inserted) throw new WorkflowError(error?.message ?? "payment request insert failed", "database");
  const request: PaymentRequestRow = inserted;

  try {
    const started = await startCheckout(admin, {
      request,
      reference: order.reference,
      description: `${sale.event.name}: ${label}`,
      customer: { email: order.email, firstName: order.buyer_first_name, lastName: order.buyer_last_name },
      // No token here: the gateway would keep the link to the tickets in its
      // own logs. The buyer's browser carries it in the order cookie instead
      // (`lib/events/session.ts`), and the return reads it from there.
      returnUrl: `${siteUrl()}/events/return`,
      backUrl: `${siteUrl()}${backPath}`,
      // Nothing moves until the gateway says yes. The sweep
      // (`reconcileProcessingPayments`) confirms a buyer who closes the
      // browser, and the PayGate notify does sooner.
      onStarted: async () => {},
    });
    return started.redirectUrl;
  } catch (e) {
    await admin.from("payment_requests").update({ status: "cancelled" }).eq("id", request.id).in("status", [...OPEN_REQUEST_STATUSES]);
    await admin.from("event_orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", order.id).eq("status", "pending");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reading one order back
// ---------------------------------------------------------------------------

export type OrderView = {
  order: EventOrderRow;
  tickets: EventTicketRow[];
  event: Pick<CrmEventRow, "id" | "name" | "starts_at" | "ends_at" | "location">;
  sales: Pick<EventSalesRow, "slug" | "ticket_label" | "show_time">;
  campusName: string;
};

/**
 * A new link to an order's tickets, for an email. Minted at send time, as
 * every link here is, so the raw value is in the email and nowhere else.
 */
export async function mintOrderLink(admin: AdminClient, orderId: string): Promise<string> {
  const token = mintOrderToken();
  const { error } = await admin.from("event_order_links").insert({ token_hash: hashToken(token), order_id: orderId, created_reason: "email" });
  if (error) throw new Error(error.message);
  return ticketsUrl(token);
}

/** The order a link opens, or null. */
export async function orderIdForToken(admin: AdminClient, token: string): Promise<string | null> {
  if (!isOrderToken(token)) return null;
  const { data, error } = await admin.from("event_order_links").select("order_id").eq("token_hash", hashToken(token)).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.order_id ?? null;
}

/** One order and its tickets, by a link. Null for a link that is not one of ours. */
export async function loadOrderByToken(admin: AdminClient, token: string): Promise<OrderView | null> {
  const orderId = await orderIdForToken(admin, token);
  if (!orderId) return null;
  const { data: order, error } = await admin.from("event_orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!order || order.anonymised_at) return null;
  const [{ data: tickets, error: tErr }, { data: event, error: eErr }, { data: sales, error: sErr }, { data: campus }] = await Promise.all([
    admin.from("event_tickets").select("*").eq("order_id", order.id).order("number"),
    admin.from("crm_events").select("id, name, starts_at, ends_at, location").eq("id", order.event_id).single(),
    admin.from("event_sales").select("slug, ticket_label, show_time").eq("event_id", order.event_id).single(),
    admin.from("campuses").select("name").eq("id", order.campus_id).maybeSingle(),
  ]);
  if (tErr) throw new Error(tErr.message);
  if (eErr || !event) throw new Error(eErr?.message ?? "event missing");
  if (sErr || !sales) throw new Error(sErr?.message ?? "sales missing");
  return { order, tickets: tickets ?? [], event, sales, campusName: campus?.name ?? "" };
}

/**
 * This order's recent online attempts, for the return and "check again".
 * Expired and failed ones too, for the reason `lib/payments/attempts.ts`
 * gives: a buyer who finished on their bank's screen after we stopped
 * waiting has paid, and asking again with `revive` is how that is found.
 */
export async function orderPaymentAttempts(admin: AdminClient, orderId: string): Promise<PaymentRow[]> {
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("event_order_id", orderId)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .not("provider_ref", "is", null)
    .gte("created_at", recentAttemptsSince())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The attempt the gateway named in a cross-site return post, if it belongs to
 * an event order at all. The post carries no cookie, so the gateway's own
 * reference is what finds it; the verdict still comes from asking the
 * gateway, in `reconcilePayment`.
 */
export async function eventPaymentByProviderRef(admin: AdminClient, providerRef: string): Promise<PaymentRow | null> {
  if (!providerRef) return null;
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("provider_ref", providerRef)
    .not("event_order_id", "is", null)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** "P 450.00", for the pages. */
export function orderTotal(order: Pick<EventOrderRow, "amount_minor" | "currency">): string {
  return formatMoney(Number(order.amount_minor), order.currency);
}
