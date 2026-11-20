import { describe, expect, it } from "vitest";
import {
  earlyUntilFromLastDay,
  firstDayFromOfferFrom,
  lastDayFromEarlyUntil,
  normaliseTicketNumber,
  offerFromFirstDay,
  parseSalesForm,
  safeCell,
} from "@/lib/events/sales-form";

const FORM = {
  slug: "christmas-show",
  ticketPrice: "200",
  earlyPrice: "P 150.00",
  earlyLastDay: "2026-11-27",
  maxTickets: "10",
  stallPrice: "750",
  stallTickets: "2",
  stallCapacity: "",
  ticketPrefix: "hcs",
  ticketLabel: "Ticket",
  ticketsOpen: "on",
};

describe("parseSalesForm", () => {
  it("reads prices as the school types them and the early bird's last day as a day", () => {
    const r = parseSalesForm(FORM);
    expect(r).toMatchObject({
      ok: true,
      value: {
        ticket_price_minor: 20000,
        early_price_minor: 15000,
        early_until: "2026-11-27T22:00:00.000Z",
        stall_price_minor: 75000,
        stall_capacity: null,
        ticket_prefix: "HCS",
        tickets_open: true,
        stalls_open: false,
        show_time: false,
      },
    });
  });

  it("wants an early price and its last day together, or neither", () => {
    expect(parseSalesForm({ ...FORM, earlyLastDay: "" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, earlyPrice: "", earlyLastDay: "" })).toMatchObject({ ok: true, value: { early_price_minor: null, early_until: null } });
  });

  it("will not open stall bookings without a stall price", () => {
    expect(parseSalesForm({ ...FORM, stallPrice: "", stallsOpen: "on" }).ok).toBe(false);
  });

  it("refuses an address with spaces or capitals, and a bad prefix", () => {
    expect(parseSalesForm({ ...FORM, slug: "Christmas Show" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, ticketPrefix: "H1" }).ok).toBe(false);
  });
});

describe("a special offer on the form", () => {
  // The school's Black Friday poster of 20 November 2026.
  const OFFER = { offerName: " Black Friday ", offerPrice: "150", offerFirstDay: "2026-11-23", offerLastDay: "2026-12-01" };

  it("reads its first and last day as whole school days", () => {
    expect(parseSalesForm({ ...FORM, ...OFFER })).toMatchObject({
      ok: true,
      value: { offer_name: "Black Friday", offer_price_minor: 15000, offer_from: "2026-11-22T22:00:00.000Z", offer_until: "2026-12-01T22:00:00.000Z" },
    });
  });

  it("clears the offer when all four boxes are empty", () => {
    expect(parseSalesForm({ ...FORM, offerName: "", offerPrice: "", offerFirstDay: "", offerLastDay: "" })).toMatchObject({
      ok: true,
      value: { offer_name: null, offer_price_minor: null, offer_from: null, offer_until: null },
    });
  });

  it("leaves the offer alone when the form has no boxes for it", () => {
    // A tickets page left open from before the offer existed: saving it must
    // not write the offer columns at all, or it would end a running offer.
    const r = parseSalesForm(FORM);
    expect(r.ok && "offer_name" in r.value).toBe(false);
    expect(r.ok && "offer_until" in r.value).toBe(false);
  });

  it("wants all four boxes, in order, and a price below the ticket price", () => {
    expect(parseSalesForm({ ...FORM, ...OFFER, offerLastDay: "" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, ...OFFER, offerName: "" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, ...OFFER, offerFirstDay: "2026-12-02" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, ...OFFER, offerPrice: "200" }).ok).toBe(false);
    expect(parseSalesForm({ ...FORM, ...OFFER, offerName: "x".repeat(41) }).ok).toBe(false);
    // One day is an offer: it starts and ends on the same day.
    expect(parseSalesForm({ ...FORM, ...OFFER, offerLastDay: "2026-11-23" })).toMatchObject({ ok: true, value: { offer_until: "2026-11-23T22:00:00.000Z" } });
  });

  it("round-trips its first day through the moment it starts", () => {
    expect(offerFromFirstDay("2026-11-23")).toBe("2026-11-22T22:00:00.000Z");
    expect(firstDayFromOfferFrom("2026-11-22T22:00:00.000Z")).toBe("2026-11-23");
    expect(firstDayFromOfferFrom(null)).toBe("");
    expect(offerFromFirstDay("23 November")).toBeNull();
  });
});

describe("the early bird's last day", () => {
  it("round-trips through the moment it ends", () => {
    expect(earlyUntilFromLastDay("2026-11-27")).toBe("2026-11-27T22:00:00.000Z");
    expect(lastDayFromEarlyUntil("2026-11-27T22:00:00.000Z")).toBe("2026-11-27");
    expect(lastDayFromEarlyUntil(null)).toBe("");
    expect(earlyUntilFromLastDay("27/11/2026")).toBeNull();
  });
});

describe("at the gate and in the spreadsheet", () => {
  it("reads a ticket number however it was typed", () => {
    expect(normaliseTicketNumber("  hcs-0042-k7q ")).toBe("HCS-0042-K7Q");
  });

  it("keeps a typed formula from running when the list is opened", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeCell("+27 71")).toBe("'+27 71");
    expect(safeCell("Mpho's Bakes")).toBe("Mpho's Bakes");
    expect(safeCell(null)).toBe("");
  });
});
