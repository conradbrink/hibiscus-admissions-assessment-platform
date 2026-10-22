import { parseMoneyToMinor } from "@/lib/money";
import type { EventSalesRow } from "@/lib/supabase/types";

/**
 * The staff form for an event's sales, read and written in the school's own
 * terms: prices typed as "150" or "P 150.00", and the early price's last day
 * as a date. Stored as minor units and as the moment the early price stops,
 * which is midnight at the start of the next day in school time (UTC+2, as
 * every campus is).
 *
 * Pure. Unit tested.
 */

export type SalesFields = Pick<
  EventSalesRow,
  | "slug"
  | "ticket_label"
  | "ticket_price_minor"
  | "early_price_minor"
  | "early_until"
  | "max_tickets_per_order"
  | "tickets_open"
  | "stall_price_minor"
  | "stall_tickets"
  | "stall_capacity"
  | "stalls_open"
  | "ticket_prefix"
  | "show_time"
  | "intro"
  | "stall_intro"
>;

/** "2026-11-27" → the instant the early price stops: 28 November, 00:00 school time. */
export function earlyUntilFromLastDay(lastDay: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return null;
  const start = new Date(`${lastDay}T00:00:00+02:00`);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + 86_400_000).toISOString();
}

/** The reverse, for the date box: the last school day the early price applies. */
export function lastDayFromEarlyUntil(earlyUntil: string | null): string {
  if (!earlyUntil) return "";
  const lastMoment = new Date(new Date(earlyUntil).getTime() - 1);
  return new Date(lastMoment.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

function whole(raw: string | undefined, min: number, max: number): number | null {
  if (!raw || !/^\d{1,4}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

export function parseSalesForm(form: Record<string, string | undefined>): { ok: true; value: SalesFields } | { ok: false; error: string } {
  const slug = (form.slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) {
    return { ok: false, error: "The web address may use small letters, numbers and single hyphens, 3 to 60 characters: christmas-show." };
  }
  const ticketPrice = parseMoneyToMinor(form.ticketPrice ?? "");
  if (ticketPrice === null || ticketPrice <= 0) return { ok: false, error: "Enter the ticket price." };

  const earlyRaw = (form.earlyPrice ?? "").trim();
  const earlyDay = (form.earlyLastDay ?? "").trim();
  let earlyPrice: number | null = null;
  let earlyUntil: string | null = null;
  if (earlyRaw || earlyDay) {
    earlyPrice = parseMoneyToMinor(earlyRaw);
    earlyUntil = earlyUntilFromLastDay(earlyDay);
    if (earlyPrice === null || earlyPrice <= 0 || !earlyUntil) {
      return { ok: false, error: "An early-bird price needs both a price and its last day. Leave both empty for no early price." };
    }
  }

  const stallRaw = (form.stallPrice ?? "").trim();
  const stallPrice = stallRaw ? parseMoneyToMinor(stallRaw) : null;
  if (stallRaw && (stallPrice === null || stallPrice <= 0)) return { ok: false, error: "Enter the stall price, or leave it empty for no stalls." };

  const maxTickets = whole(form.maxTickets, 1, 30);
  if (maxTickets === null) return { ok: false, error: "Tickets per order must be a whole number from 1 to 30." };
  const stallTickets = whole(form.stallTickets, 1, 10);
  if (stallTickets === null) return { ok: false, error: "Tickets per stall must be a whole number from 1 to 10." };
  const capacityRaw = (form.stallCapacity ?? "").trim();
  const stallCapacity = capacityRaw ? whole(capacityRaw, 1, 9999) : null;
  if (capacityRaw && stallCapacity === null) return { ok: false, error: "The number of stalls must be a whole number, or empty for no limit." };

  const prefix = (form.ticketPrefix ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(prefix)) return { ok: false, error: "The ticket number prefix is 2 to 6 capital letters: HCS." };
  const label = (form.ticketLabel ?? "").trim() || "Ticket";
  if (label.length > 40) return { ok: false, error: "The ticket's name is too long." };

  const stallsOpen = form.stallsOpen === "on";
  if (stallsOpen && stallPrice === null) return { ok: false, error: "Set a stall price before opening stall bookings." };

  return {
    ok: true,
    value: {
      slug,
      ticket_label: label,
      ticket_price_minor: ticketPrice,
      early_price_minor: earlyPrice,
      early_until: earlyUntil,
      max_tickets_per_order: maxTickets,
      tickets_open: form.ticketsOpen === "on",
      stall_price_minor: stallPrice,
      stall_tickets: stallTickets,
      stall_capacity: stallCapacity,
      stalls_open: stallsOpen,
      ticket_prefix: prefix,
      show_time: form.showTime === "on",
      intro: (form.intro ?? "").trim().slice(0, 4000) || null,
      stall_intro: (form.stallIntro ?? "").trim().slice(0, 4000) || null,
    },
  };
}

/** "HCS-0042-K7Q" as a person types it at the gate: any case, spaces or none. */
export function normaliseTicketNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** A spreadsheet cell a stranger typed must not be read as a formula when the file is opened. */
export function safeCell(value: string | null | undefined): string {
  const s = value ?? "";
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
