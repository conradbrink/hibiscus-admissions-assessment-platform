"use server";

import { redirect } from "next/navigation";
import { parseStallOrder, parseTicketOrder } from "@/lib/events/input";
import { loadSaleEvent, placeOrder, startOrderCheckout } from "@/lib/events/orders";
import { rememberOrder } from "@/lib/events/session";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * Buying tickets and booking a stall.
 *
 * Nobody here holds a session: these are public pages, open to anybody who
 * has the link. So the event comes from the URL and must be on sale, the
 * address is rate limited, and nothing in the form carries a figure — the
 * price is decided by `create_event_order()` from the event's own prices at
 * the moment the order is taken.
 *
 * The browser keeps the order's link in a cookie (`lib/events/session.ts`),
 * so the gateway's return can find it without the link passing through the
 * gateway.
 */

export type EventFormState = {
  error?: string;
  /** Field name → what is wrong with it, for the boxes. */
  errors?: Record<string, string>;
  /** What was typed, so a refusal does not empty the form. */
  values?: Record<string, string>;
};

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && key.length <= 40) out[key] = value.slice(0, 600);
  }
  return out;
}

async function guard(form: Record<string, string>): Promise<EventFormState | null> {
  // A hidden box only a script fills in. Refused without saying why.
  if (form.website) return { error: "We could not take your order just now. Please try again in a moment." };
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(createAdminClient(), LIMITS.eventOrder, ctx.ipHash ?? "unknown");
  if (!verdict.ok) return { error: "Too many tries from this connection. Please wait a few minutes and try again.", values: form };
  return null;
}

function failed(e: unknown, form: Record<string, string>): EventFormState {
  if (e instanceof WorkflowError) return { error: e.message, values: form };
  console.error("[events] order failed", e);
  return { error: "We could not take your order just now. Please try again in a moment.", values: form };
}

export async function buyTickets(slug: string, _: EventFormState, formData: FormData): Promise<EventFormState> {
  const form = fields(formData);
  const refused = await guard(form);
  if (refused) return refused;

  const admin = createAdminClient();
  const sale = await loadSaleEvent(admin, slug);
  if (!sale) return { error: "This event is not on sale." };
  const parsed = parseTicketOrder(form, sale.sales.max_tickets_per_order);
  if (!parsed.ok) return { errors: parsed.errors, values: form, error: "Please check the boxes marked below." };

  let url: string;
  try {
    const { order, token } = await placeOrder(admin, sale, { kind: "tickets", ...parsed.value });
    await rememberOrder(token);
    url = await startOrderCheckout(admin, sale, order, `/events/${sale.sales.slug}?cancelled=1`);
  } catch (e) {
    return failed(e, form);
  }
  redirect(url);
}

export async function bookStall(slug: string, _: EventFormState, formData: FormData): Promise<EventFormState> {
  const form = fields(formData);
  const refused = await guard(form);
  if (refused) return refused;

  const admin = createAdminClient();
  const sale = await loadSaleEvent(admin, slug);
  if (!sale || sale.sales.stall_price_minor === null) return { error: "Stalls are not available for this event." };
  const parsed = parseStallOrder(form, sale.sales.stall_tickets);
  if (!parsed.ok) return { errors: parsed.errors, values: form, error: "Please check the boxes marked below." };

  let url: string;
  try {
    const { order, token } = await placeOrder(admin, sale, { kind: "stall", ...parsed.value });
    await rememberOrder(token);
    url = await startOrderCheckout(admin, sale, order, `/events/${sale.sales.slug}/stall?cancelled=1`);
  } catch (e) {
    return failed(e, form);
  }
  redirect(url);
}
