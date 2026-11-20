import { formatDateLong, formatTime } from "@/lib/format-date";
import type { CrmEventRow, EventSalesRow } from "@/lib/supabase/types";

/**
 * What a ticket costs right now, what it will cost next, and how to say when
 * the event is.
 *
 * The price a buyer is charged is decided in the database, by
 * `create_event_order()`, under a lock and on the database's clock. This is
 * the same rule for the page: the price on the button and the countdown to
 * the price changing. The two must agree, so the rule is a few lines in each
 * place and a test here pins this half of it.
 *
 * Three prices, in the order they are tried: the early price until its
 * moment, the standard price after it, and, while a dated offer runs (Black
 * Friday at the Christmas Show, 20 November 2026), the offer's price if it is
 * the lower one. An offer never makes a ticket dearer.
 *
 * Pure: no clock of its own. Every caller passes `now`.
 */

export type SalesPrices = Pick<
  EventSalesRow,
  "ticket_price_minor" | "early_price_minor" | "early_until" | "offer_name" | "offer_price_minor" | "offer_from" | "offer_until"
>;

/** One price a ticket can have: what it costs, and what the order calls it. */
export type PriceStep = {
  unitMinor: number;
  /** "Early bird", "Standard", or the offer's own name. Stored on the order as its `price_name`. */
  name: string;
  kind: "offer" | "early" | "standard";
};

export type TicketPrice = PriceStep & {
  /** While an offer applies: what a ticket would cost at this moment without it. */
  usualMinor: number | null;
  /** When this price stops, if it does. */
  endsAt: Date | null;
  /** The price from that moment on. */
  next: PriceStep | null;
};

const at = (moment: string | null | undefined): number | null => (moment ? new Date(moment).getTime() : null);

/** The price with no offer: early until its moment, standard after. */
function usualStep(sales: SalesPrices, t: number): PriceStep {
  const until = at(sales.early_until);
  if (until !== null && sales.early_price_minor !== null && t < until) {
    return { unitMinor: sales.early_price_minor, name: "Early bird", kind: "early" };
  }
  return { unitMinor: sales.ticket_price_minor, name: "Standard", kind: "standard" };
}

function stepAt(sales: SalesPrices, t: number): PriceStep {
  const usual = usualStep(sales, t);
  const from = at(sales.offer_from);
  const until = at(sales.offer_until);
  const offer = sales.offer_price_minor ?? null;
  if (sales.offer_name && offer !== null && from !== null && until !== null && t >= from && t < until && offer < usual.unitMinor) {
    return { unitMinor: offer, name: sales.offer_name.trim(), kind: "offer" };
  }
  return usual;
}

export function ticketPriceAt(sales: SalesPrices, now: Date): TicketPrice {
  const t = now.getTime();
  const current = stepAt(sales, t);
  const usualMinor = current.kind === "offer" ? usualStep(sales, t).unitMinor : null;
  // The moments a price can change, soonest first. The price ends at the
  // first one where it really does: an early price that stops in the middle
  // of an offer changes nothing a buyer pays, so it is passed over.
  const moments = [at(sales.early_until), at(sales.offer_from), at(sales.offer_until)]
    .filter((m): m is number => m !== null && m > t)
    .sort((a, b) => a - b);
  for (const m of moments) {
    const next = stepAt(sales, m);
    if (next.unitMinor !== current.unitMinor || next.kind !== current.kind) {
      return { ...current, usualMinor, endsAt: new Date(m), next };
    }
  }
  return { ...current, usualMinor, endsAt: null, next: null };
}

/**
 * The offer, while the page should still name it: one that is set, has not
 * ended, and is below the standard price. Null once it is over.
 */
export function offerToShow(sales: SalesPrices, now: Date): { name: string; unitMinor: number; from: Date; until: Date; running: boolean } | null {
  const from = at(sales.offer_from);
  const until = at(sales.offer_until);
  const offer = sales.offer_price_minor ?? null;
  if (!sales.offer_name || offer === null || from === null || until === null) return null;
  const t = now.getTime();
  if (t >= until || offer >= sales.ticket_price_minor) return null;
  return { name: sales.offer_name.trim(), unitMinor: offer, from: new Date(from), until: new Date(until), running: stepAt(sales, t).kind === "offer" };
}

/** The last day a price applies, as a buyer reads it: an end at midnight is the day before. */
export function lastDay(until: Date): Date {
  return new Date(until.getTime() - 1);
}

export type EventTiming = Pick<CrmEventRow, "starts_at" | "ends_at" | "is_cancelled">;

/** Whether the event is still ahead: sales stop a day after it starts unless it says when it ends. */
export function eventStillAhead(event: EventTiming, now: Date): boolean {
  if (event.is_cancelled) return false;
  const end = event.ends_at ? new Date(event.ends_at) : new Date(new Date(event.starts_at).getTime() + 86_400_000);
  return now.getTime() <= end.getTime();
}

/**
 * "Friday 4 December 2026", or "Friday 4 December 2026 at 17:00" once the
 * school has said the time is real (`show_time`). A show whose time is not
 * announced yet still needs a time on its event row; it must not print it.
 */
export function eventWhen(event: Pick<CrmEventRow, "starts_at" | "ends_at">, showTime: boolean): string {
  const day = formatDateLong(event.starts_at);
  if (!showTime) return day;
  const start = formatTime(event.starts_at);
  return event.ends_at ? `${day}, ${start} to ${formatTime(event.ends_at)}` : `${day} at ${start}`;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };

/** Whole days, hours, minutes and seconds until a moment; all zero once it has passed. */
export function countdownParts(target: Date, now: Date): CountdownParts {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}
