import { formatDateLong, formatTime } from "@/lib/format-date";
import type { CrmEventRow, EventSalesRow } from "@/lib/supabase/types";

/**
 * What a ticket costs right now, what it will cost next, and how to say when
 * the event is.
 *
 * The price a buyer is charged is decided in the database, by
 * `create_event_order()`, under a lock and on the database's clock. This is
 * the same rule for the page: the price on the button and the countdown to
 * the early price ending. The two must agree, so the rule is one line in each
 * place and a test here pins this half of it.
 *
 * Pure: no clock of its own. Every caller passes `now`.
 */

export type SalesPrices = Pick<EventSalesRow, "ticket_price_minor" | "early_price_minor" | "early_until">;

export type TicketPrice = {
  unitMinor: number;
  name: "Early bird" | "Standard";
  /** When the early price stops, while it still applies. */
  earlyEndsAt: Date | null;
  /** The price after the early one ends, while the early one applies. */
  laterMinor: number | null;
};

export function ticketPriceAt(sales: SalesPrices, now: Date): TicketPrice {
  const until = sales.early_until ? new Date(sales.early_until) : null;
  if (until && sales.early_price_minor !== null && now.getTime() < until.getTime()) {
    return { unitMinor: sales.early_price_minor, name: "Early bird", earlyEndsAt: until, laterMinor: sales.ticket_price_minor };
  }
  return { unitMinor: sales.ticket_price_minor, name: "Standard", earlyEndsAt: null, laterMinor: null };
}

/** The last day of the early price, as a buyer reads it: an end at midnight is the day before. */
export function earlyLastDay(until: Date): Date {
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
