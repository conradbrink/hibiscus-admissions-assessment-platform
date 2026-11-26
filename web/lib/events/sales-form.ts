import { parseMoneyToMinor } from "@/lib/money";
import type { EventSalesRow } from "@/lib/supabase/types";

/**
 * The staff form for an event's sales, read and written in the school's own
 * terms: prices typed as "150" or "P 150.00", and the early price's last day
 * as a date. Stored as minor units and as the moment the early price stops,
 * which is midnight at the start of the next day in school time (UTC+2, as
 * every campus is). A dated offer is typed the same way: a name, a price, a
 * first day and a last day, and, if stalls are on offer too, a stall price.
 *
 * Pure. Unit tested.
 */

export type OfferFields = Pick<EventSalesRow, "offer_name" | "offer_price_minor" | "offer_from" | "offer_until" | "offer_stall_price_minor">;

const NO_OFFER: OfferFields = { offer_name: null, offer_price_minor: null, offer_from: null, offer_until: null, offer_stall_price_minor: null };

/**
 * What a save writes. The offer is written only when the form carried its
 * boxes: a page left open from before the offer existed has none, and saving
 * it must not wipe an offer that is running.
 */
export type SalesFields = Partial<OfferFields> & Pick<
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

/** "2026-11-23" → the instant that day starts in school time. A day that does not exist is null. */
function dayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00+02:00`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/** "2026-11-27" → the instant the early price stops: 28 November, 00:00 school time. */
export function earlyUntilFromLastDay(lastDay: string): string | null {
  const start = dayStart(lastDay);
  return start ? new Date(start.getTime() + 86_400_000).toISOString() : null;
}

/** The reverse, for the date box: the last school day a price applies, from the moment it stops. */
export function lastDayFromEarlyUntil(earlyUntil: string | null): string {
  if (!earlyUntil) return "";
  const lastMoment = new Date(new Date(earlyUntil).getTime() - 1);
  return new Date(lastMoment.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

/** "2026-11-23" → the instant an offer starts: that day, 00:00 school time. */
export function offerFromFirstDay(firstDay: string): string | null {
  return dayStart(firstDay)?.toISOString() ?? null;
}

/** The reverse, for the date box: the school day an offer starts on. */
export function firstDayFromOfferFrom(offerFrom: string | null): string {
  if (!offerFrom) return "";
  return new Date(new Date(offerFrom).getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The offer's four boxes: all filled in, or all empty for no offer. The price
 * must be below the ticket price, or it is not an offer; `create_event_order()`
 * would never charge it.
 *
 * A fifth box, the offer's price for a stall, is optional and the same rule
 * applies: below the stall price. It is written only when the form carried
 * it, for the same reason as the offer itself: a page left open from before
 * the box existed must not wipe it. Ending the offer always empties it, as
 * the database will not keep a stall price with no offer beside it.
 */
function parseOffer(
  form: Record<string, string | undefined>,
  ticketPrice: number,
  stallPrice: number | null,
): { ok: true; value: Partial<OfferFields> } | { ok: false; error: string } {
  const name = (form.offerName ?? "").trim();
  const priceRaw = (form.offerPrice ?? "").trim();
  const firstDay = (form.offerFirstDay ?? "").trim();
  const lastDay = (form.offerLastDay ?? "").trim();
  const stallRaw = (form.offerStallPrice ?? "").trim();
  if (!name && !priceRaw && !firstDay && !lastDay) {
    if (stallRaw) return { ok: false, error: "A stall's offer price belongs to a special offer. Fill in the offer's name, price and days, or empty the stall's offer price." };
    return { ok: true, value: NO_OFFER };
  }

  const price = parseMoneyToMinor(priceRaw);
  const from = offerFromFirstDay(firstDay);
  const until = earlyUntilFromLastDay(lastDay);
  if (!name || price === null || price <= 0 || !from || !until) {
    return { ok: false, error: "A special offer needs a name, a price, a first day and a last day. Leave all four empty for no offer." };
  }
  if (name.length > 40) return { ok: false, error: "The offer's name is too long. Use 40 characters or fewer: Black Friday." };
  if (from >= until) return { ok: false, error: "The offer's last day is before its first day." };
  if (price >= ticketPrice) return { ok: false, error: "The offer price must be lower than the ticket price." };
  const value: Partial<OfferFields> = { offer_name: name, offer_price_minor: price, offer_from: from, offer_until: until };

  if (form.offerStallPrice !== undefined) {
    if (!stallRaw) {
      value.offer_stall_price_minor = null;
    } else {
      const stallOffer = parseMoneyToMinor(stallRaw);
      if (stallOffer === null || stallOffer <= 0) return { ok: false, error: "Enter the stall's offer price, or leave it empty for no stall offer." };
      if (stallPrice === null) return { ok: false, error: "Set a stall price before giving stalls an offer price." };
      if (stallOffer >= stallPrice) return { ok: false, error: "The stall's offer price must be lower than the stall price." };
      value.offer_stall_price_minor = stallOffer;
    }
  }
  return { ok: true, value };
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

  // Only a form that has the offer's boxes may change the offer.
  const hasOfferBoxes =
    form.offerName !== undefined || form.offerPrice !== undefined || form.offerFirstDay !== undefined || form.offerLastDay !== undefined || form.offerStallPrice !== undefined;
  const offer = hasOfferBoxes ? parseOffer(form, ticketPrice, stallPrice) : null;
  if (offer && !offer.ok) return offer;

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
      ...(offer ? offer.value : {}),
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
