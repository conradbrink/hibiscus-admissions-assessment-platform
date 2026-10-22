import { describe, expect, it } from "vitest";
import { countdownParts, earlyLastDay, eventStillAhead, eventWhen, ticketPriceAt } from "@/lib/events/pricing";
import { formatDateLong } from "@/lib/format-date";

// The Christmas Show, as seeded: P150 until the end of Friday 27 November
// (school time), P200 after.
const SALES = { ticket_price_minor: 20000, early_price_minor: 15000, early_until: "2026-11-27T22:00:00.000Z" };

describe("ticketPriceAt", () => {
  it("charges the early price until the second it ends", () => {
    const p = ticketPriceAt(SALES, new Date("2026-11-27T21:59:59.999Z"));
    expect(p).toMatchObject({ unitMinor: 15000, name: "Early bird", laterMinor: 20000 });
    expect(p.earlyEndsAt?.toISOString()).toBe("2026-11-27T22:00:00.000Z");
  });

  it("charges the standard price from that second on, as create_event_order() does", () => {
    expect(ticketPriceAt(SALES, new Date("2026-11-27T22:00:00.000Z"))).toEqual({ unitMinor: 20000, name: "Standard", earlyEndsAt: null, laterMinor: null });
  });

  it("charges the standard price when there is no early price", () => {
    expect(ticketPriceAt({ ticket_price_minor: 20000, early_price_minor: null, early_until: null }, new Date("2026-10-22T09:00:00Z")).unitMinor).toBe(20000);
  });
});

describe("earlyLastDay", () => {
  it("names the day before an end at midnight, in school time", () => {
    expect(formatDateLong(earlyLastDay(new Date(SALES.early_until)))).toBe(formatDateLong("2026-11-27"));
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
