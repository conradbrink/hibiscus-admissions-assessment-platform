import { describe, expect, it } from "vitest";
import { earlyUntilFromLastDay, lastDayFromEarlyUntil, normaliseTicketNumber, parseSalesForm, safeCell } from "@/lib/events/sales-form";

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
