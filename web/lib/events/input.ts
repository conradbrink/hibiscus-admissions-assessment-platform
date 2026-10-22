import { z } from "zod";
import { fieldErrors, mobileNumber, optionalMobileNumber, personName } from "@/lib/validation";

/**
 * What the public ticket and stall forms send, checked.
 *
 * The same rules run in the browser, so a buyer sees the problem on the field,
 * and in the action, which trusts nothing the browser said. The forms carry
 * names, an address, a number and how many tickets; never a price. The amount
 * is decided by `create_event_order()` from the event's own prices.
 *
 * Every ticket has a person's name on it, because the gate checks one name
 * per number. The forms name their fields `holderFirst0`, `holderLast0`, and
 * so on; an error comes back under the same name, so the page can put it
 * beside the right box.
 *
 * Pure. Unit tested.
 */

export type Holder = { firstName: string; lastName: string };

export type Buyer = { firstName: string; lastName: string; email: string; mobile: string | null };

export type TicketOrderInput = { buyer: Buyer; holders: Holder[] };

export type StallOrderInput = {
  buyer: Buyer;
  businessName: string;
  goods: string | null;
  needsPower: boolean;
  /** The stallholder first, then their staff: one per ticket the stall comes with. */
  holders: Holder[];
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

type FormFields = Record<string, string | undefined>;

const email = z.email("Enter a valid email address").max(200, "Too long");

const ticketBuyer = z.object({
  firstName: personName,
  lastName: personName,
  email,
  mobile: optionalMobileNumber,
});

const stallBuyer = z.object({
  firstName: personName,
  lastName: personName,
  email,
  // A trader the school cannot ring on the morning is a stall nobody can
  // find a place for, so the number is required here.
  mobile: mobileNumber,
  businessName: z.string().trim().min(1, "Give the name of your business or stall").max(120, "Too long"),
  goods: z.string().trim().max(500, "Too long").optional(),
});

/** One name per ticket, under the field names the form used. */
function readHolders(form: FormFields, count: number, errors: Record<string, string>, from = 0): Holder[] {
  const holders: Holder[] = [];
  for (let i = from; i < from + count; i++) {
    const first = personName.safeParse(form[`holderFirst${i}`] ?? "");
    const last = personName.safeParse(form[`holderLast${i}`] ?? "");
    if (!first.success) errors[`holderFirst${i}`] = first.error.issues[0]?.message ?? "Required";
    if (!last.success) errors[`holderLast${i}`] = last.error.issues[0]?.message ?? "Required";
    if (first.success && last.success) holders.push({ firstName: first.data, lastName: last.data });
  }
  return holders;
}

/** How many tickets, as a whole number from one to the event's limit. */
export function readQuantity(raw: string | undefined, max: number): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= max ? n : null;
}

export function parseTicketOrder(form: FormFields, maxTickets: number): Parsed<TicketOrderInput> {
  const errors: Record<string, string> = {};
  const quantity = readQuantity(form.quantity, maxTickets);
  if (quantity === null) errors.quantity = `Choose from 1 to ${maxTickets} tickets`;

  const buyer = ticketBuyer.safeParse({
    firstName: form.firstName ?? "",
    lastName: form.lastName ?? "",
    email: form.email ?? "",
    mobile: form.mobile || undefined,
  });
  if (!buyer.success) Object.assign(errors, fieldErrors(buyer.error));

  const holders = quantity === null ? [] : readHolders(form, quantity, errors);
  if (!buyer.success || quantity === null || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { buyer: { ...buyer.data, email: buyer.data.email.toLowerCase() }, holders } };
}

/**
 * A stall: the business, the person booking it, and a name for each of the
 * stall's other tickets. The person booking is the first ticket holder; the
 * form asks only for the rest (`holderFirst1` onward).
 */
export function parseStallOrder(form: FormFields, stallTickets: number): Parsed<StallOrderInput> {
  const errors: Record<string, string> = {};
  const buyer = stallBuyer.safeParse({
    firstName: form.firstName ?? "",
    lastName: form.lastName ?? "",
    email: form.email ?? "",
    mobile: form.mobile ?? "",
    businessName: form.businessName ?? "",
    goods: form.goods || undefined,
  });
  if (!buyer.success) Object.assign(errors, fieldErrors(buyer.error));

  const staff = readHolders(form, Math.max(0, stallTickets - 1), errors, 1);
  if (!buyer.success || Object.keys(errors).length) return { ok: false, errors };
  const { businessName, goods, ...person } = buyer.data;
  return {
    ok: true,
    value: {
      buyer: { ...person, email: person.email.toLowerCase() },
      businessName,
      goods: goods || null,
      needsPower: form.needsPower === "on" || form.needsPower === "1",
      holders: [{ firstName: person.firstName, lastName: person.lastName }, ...staff],
    },
  };
}

/** The shape `create_event_order()` takes. */
export function holdersJson(holders: Holder[]): Array<{ first_name: string; last_name: string }> {
  return holders.map((h) => ({ first_name: h.firstName, last_name: h.lastName }));
}

/**
 * What a refusal from `create_event_order()` means to a buyer. The function
 * raises a short code; anything else is ours, not theirs, and reads as
 * "try again" rather than as a database error.
 */
export function orderRefusal(message: string): string {
  const code = message.match(/\b(not_on_sale|event_cancelled|event_over|tickets_closed|stalls_closed|stalls_full|bad_quantity|bad_holders|bad_kind|sold_out)\b/)?.[1];
  switch (code) {
    case "tickets_closed":
      return "Tickets are not on sale at the moment.";
    case "stalls_closed":
      return "Stall bookings are not open at the moment.";
    case "stalls_full":
      return "All the stalls are booked. Please contact the school to go on the waiting list.";
    case "sold_out":
      return "There are not enough tickets left for that many people. Please choose fewer tickets.";
    case "event_cancelled":
      return "This event has been cancelled.";
    case "event_over":
      return "This event has already taken place.";
    case "bad_quantity":
    case "bad_holders":
    case "bad_kind":
      return "Please check the names and the number of tickets, then try again.";
    case "not_on_sale":
      return "This event is not on sale.";
    default:
      return "We could not take your order just now. Please try again in a moment.";
  }
}
