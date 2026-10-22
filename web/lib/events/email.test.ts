import { describe, expect, it } from "vitest";
import { ticketLines } from "@/lib/events/email";

describe("ticketLines", () => {
  it("puts the number first, one ticket a line", () => {
    expect(
      ticketLines([
        { number: "HCS-0001-K7Q", label: "Ticket", holder_first_name: "Neo", holder_last_name: "Molefe" },
        { number: "HCS-0002-TQ4", label: "Stall staff", holder_first_name: "Tumi", holder_last_name: "Sello" },
      ])
    ).toBe("HCS-0001-K7Q · Ticket · Neo Molefe\nHCS-0002-TQ4 · Stall staff · Tumi Sello");
  });
});
