import { describe, expect, it } from "vitest";
import { countdownParts, eventStillAhead, eventWhen, lastDay, offerToShow, ticketPriceAt } from "@/lib/events/pricing";
import { formatDateLong } from "@/lib/format-date";

const NO_OFFER = { offer_name: null, offer_price_minor: null, offer_from: null, offer_until: null };

// The Christmas Show, as seeded: P150 until the end of Friday 27 November
// (school time), P200 after.
const SALES = { ticket_price_minor: 20000, early_price_minor: 15000, early_until: "2026-11-27T22:00:00.000Z", ...NO_OFFER };

// The Christmas Show as it stood on 20 November 2026, with the school's Black
// Friday poster loaded: P180 early until the end of 27 November, P220 after,
// and P150 from 23 November to the end of 1 December.
const BLACK_FRIDAY = {
  ticket_price_minor: 22000,
  early_price_minor: 18000,
  early_until: "2026-11-27T22:00:00.000Z",
  offer_name: "Black Friday",
  offer_price_minor: 15000,
  offer_from: "2026-11-22T22:00:00.000Z",
  offer_until: "2026-12-01T22:00:00.000Z",
};

describe("ticketPriceAt", () => {
  it("charges the early price until the second it ends", () => {
    const p = ticketPriceAt(SALES, new Date("2026-11-27T21:59:59.999Z"));
    expect(p).toMatchObject({ unitMinor: 15000, name: "Early bird", kind: "early", usualMinor: null, next: { unitMinor: 20000, name: "Standard", kind: "standard" } });
    expect(p.endsAt?.toISOString()).toBe("2026-11-27T22:00:00.000Z");
  });

  it("charges the standard price from that second on, as create_event_order() does", () => {
    expect(ticketPriceAt(SALES, new Date("2026-11-27T22:00:00.000Z"))).toEqual({ unitMinor: 20000, name: "Standard", kind: "standard", usualMinor: null, endsAt: null, next: null });
  });

  it("charges the standard price when there is no early price", () => {
    expect(ticketPriceAt({ ticket_price_minor: 20000, early_price_minor: null, early_until: null, ...NO_OFFER }, new Date("2026-10-22T09:00:00Z")).unitMinor).toBe(20000);
  });
});

describe("a dated offer", () => {
  it("leaves the early price alone before it starts, and says the offer is next", () => {
    const p = ticketPriceAt(BLACK_FRIDAY, new Date("2026-11-22T21:59:59.999Z"));
    expect(p).toMatchObject({ unitMinor: 18000, name: "Early bird", kind: "early", usualMinor: null, next: { unitMinor: 15000, name: "Black Friday", kind: "offer" } });
    expect(p.endsAt?.toISOString()).toBe("2026-11-22T22:00:00.000Z");
  });

  it("is charged from the second it starts, under its own name, beside the price it replaces", () => {
    const p = ticketPriceAt(BLACK_FRIDAY, new Date("2026-11-22T22:00:00.000Z"));
    expect(p).toMatchObject({ unitMinor: 15000, name: "Black Friday", kind: "offer", usualMinor: 18000, next: { unitMinor: 22000, name: "Standard", kind: "standard" } });
    // The early price stops in the middle of the offer. Nothing a buyer pays
    // changes then, so the offer's own end is the one that counts.
    expect(p.endsAt?.toISOString()).toBe("2026-12-01T22:00:00.000Z");
  });

  it("is measured against the standard price once the early price has ended", () => {
    expect(ticketPriceAt(BLACK_FRIDAY, new Date("2026-11-28T08:00:00Z"))).toMatchObject({ unitMinor: 15000, kind: "offer", usualMinor: 22000 });
  });

  it("stops on the second it ends", () => {
    expect(ticketPriceAt(BLACK_FRIDAY, new Date("2026-12-01T21:59:59.999Z"))).toMatchObject({ unitMinor: 15000, kind: "offer" });
    expect(ticketPriceAt(BLACK_FRIDAY, new Date("2026-12-01T22:00:00.000Z"))).toEqual({ unitMinor: 22000, name: "Standard", kind: "standard", usualMinor: null, endsAt: null, next: null });
  });

  it("never makes a ticket dearer", () => {
    // Typed above the early price: it does nothing until the early price ends,
    // and then it is the lower price.
    const dear = { ...BLACK_FRIDAY, offer_price_minor: 20000 };
    const early = ticketPriceAt(dear, new Date("2026-11-24T08:00:00Z"));
    expect(early).toMatchObject({ unitMinor: 18000, name: "Early bird", kind: "early", usualMinor: null, next: { unitMinor: 20000, kind: "offer" } });
    expect(early.endsAt?.toISOString()).toBe("2026-11-27T22:00:00.000Z");
    expect(ticketPriceAt(dear, new Date("2026-11-28T08:00:00Z"))).toMatchObject({ unitMinor: 20000, name: "Black Friday", kind: "offer", usualMinor: 22000 });
    // Above the standard price it is never charged at all.
    expect(ticketPriceAt({ ...BLACK_FRIDAY, offer_price_minor: 25000 }, new Date("2026-11-28T08:00:00Z"))).toMatchObject({ unitMinor: 22000, kind: "standard", endsAt: null });
  });
});

describe("offerToShow", () => {
  it("names the offer before it starts and while it runs, and not once it is over", () => {
    expect(offerToShow(BLACK_FRIDAY, new Date("2026-11-20T08:00:00Z"))).toMatchObject({ name: "Black Friday", unitMinor: 15000, running: false });
    expect(offerToShow(BLACK_FRIDAY, new Date("2026-11-27T08:00:00Z"))).toMatchObject({ running: true });
    expect(offerToShow(BLACK_FRIDAY, new Date("2026-12-01T22:00:00.000Z"))).toBeNull();
  });

  it("says nothing of an offer that is not below the ticket price, or of none", () => {
    expect(offerToShow({ ...BLACK_FRIDAY, offer_price_minor: 22000 }, new Date("2026-11-27T08:00:00Z"))).toBeNull();
    expect(offerToShow(SALES, new Date("2026-11-27T08:00:00Z"))).toBeNull();
  });

  it("gives the days a buyer reads: 23 November to 1 December", () => {
    const offer = offerToShow(BLACK_FRIDAY, new Date("2026-11-20T08:00:00Z"));
    expect(formatDateLong(offer?.from)).toBe(formatDateLong("2026-11-23"));
    expect(formatDateLong(offer ? lastDay(offer.until) : null)).toBe(formatDateLong("2026-12-01"));
  });
});

describe("lastDay", () => {
  it("names the day before an end at midnight, in school time", () => {
    expect(formatDateLong(lastDay(new Date(SALES.early_until)))).toBe(formatDateLong("2026-11-27"));
  });
});

describe("eventStillAhead", () => {
  const show = { starts_at: "2026-12-03T22:00:00.000Z", ends_at: null, is_cancelled: false };

  it("sells through the day of an event with no end time", () => {
    expect(eventStillAhead(show, new Date("2026-12-04T20:00:00Z"))).toBe(true);
    expect(eventStillAhead(show, new Date("2026-12-05T22:00:01Z"))).toBe(false);
  });

  it("stops at the end time when there is one, and for a cancelled event", () => {
    expect(eventStillAhead({ ...show, ends_at: "2026-12-04T19:00:00.000Z" }, new Date("2026-12-04T19:00:01Z"))).toBe(false);
    expect(eventStillAhead({ ...show, is_cancelled: true }, new Date("2026-10-22T09:00:00Z"))).toBe(false);
  });
});

describe("eventWhen", () => {
  const show = { starts_at: "2026-12-04T15:00:00.000Z", ends_at: null };

  it("prints no time until the school has announced it", () => {
    expect(eventWhen(show, false)).toBe(formatDateLong("2026-12-04"));
  });

  it("prints the time in school time once it is real", () => {
    expect(eventWhen(show, true)).toBe(`${formatDateLong("2026-12-04")} at 17:00`);
    expect(eventWhen({ ...show, ends_at: "2026-12-04T19:30:00.000Z" }, true)).toBe(`${formatDateLong("2026-12-04")}, 17:00 to 21:30`);
  });
});

describe("countdownParts", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    const now = new Date("2026-10-22T09:47:00Z");
    expect(countdownParts(new Date(SALES.early_until), now)).toEqual({ days: 36, hours: 12, minutes: 13, seconds: 0 });
  });

  it("stops at zero", () => {
    expect(countdownParts(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-02T00:00:00Z"))).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
