import { describe, expect, it } from "vitest";
import { holdersJson, orderRefusal, parseStallOrder, parseTicketOrder, readQuantity } from "@/lib/events/input";

const BUYER = { firstName: "Neo", lastName: "Molefe", email: "Neo.Molefe@Example.com" };

describe("parseTicketOrder", () => {
  it("takes one name per ticket, in order, and lower-cases the address", () => {
    const r = parseTicketOrder(
      { ...BUYER, quantity: "2", holderFirst0: "Kago", holderLast0: "Molefe", holderFirst1: " Lesedi ", holderLast1: "Molefe" },
      10
    );
    expect(r).toEqual({
      ok: true,
      value: {
        buyer: { firstName: "Neo", lastName: "Molefe", email: "neo.molefe@example.com", mobile: null },
        holders: [
          { firstName: "Kago", lastName: "Molefe" },
          { firstName: "Lesedi", lastName: "Molefe" },
        ],
      },
    });
  });

  it("names the box a missing name belongs in", () => {
    const r = parseTicketOrder({ ...BUYER, quantity: "2", holderFirst0: "Kago", holderLast0: "Molefe", holderFirst1: "Lesedi" }, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["holderLast1"]);
  });

  it("ignores names typed for tickets the buyer then took away", () => {
    const r = parseTicketOrder({ ...BUYER, quantity: "1", holderFirst0: "Kago", holderLast0: "Molefe", holderFirst1: "<script>" }, 10);
    expect(r.ok && r.value.holders).toHaveLength(1);
  });

  it("refuses more tickets than the event allows in one order, and none", () => {
    expect(parseTicketOrder({ ...BUYER, quantity: "11" }, 10).ok).toBe(false);
    expect(parseTicketOrder({ ...BUYER, quantity: "0" }, 10).ok).toBe(false);
    expect(readQuantity("2.5", 10)).toBeNull();
    expect(readQuantity("10", 10)).toBe(10);
  });

  it("refuses a name that is not a name", () => {
    const r = parseTicketOrder({ ...BUYER, quantity: "1", holderFirst0: "=HYPERLINK(1)", holderLast0: "Molefe" }, 10);
    expect(r.ok).toBe(false);
  });

  it("takes a mobile number in the one form WhatsApp accepts", () => {
    const r = parseTicketOrder({ ...BUYER, mobile: "+26771234567", quantity: "1", holderFirst0: "Neo", holderLast0: "Molefe" }, 10);
    expect(r.ok && r.value.buyer.mobile).toBe("+26771234567");
  });
});

describe("parseStallOrder", () => {
  const STALL = { ...BUYER, mobile: "+26771234567", businessName: "Mpho's Bakes", goods: "Cakes", needsPower: "on" };

  it("makes the person booking the first ticket and their staff the rest", () => {
    const r = parseStallOrder({ ...STALL, holderFirst1: "Tumi", holderLast1: "Sello" }, 2);
    expect(r.ok && r.value).toMatchObject({
      businessName: "Mpho's Bakes",
      goods: "Cakes",
      needsPower: true,
      holders: [
        { firstName: "Neo", lastName: "Molefe" },
        { firstName: "Tumi", lastName: "Sello" },
      ],
    });
  });

  it("needs a mobile number and a business name", () => {
    const r = parseStallOrder({ ...BUYER, holderFirst1: "Tumi", holderLast1: "Sello" }, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["businessName", "mobile"]);
  });

  it("asks for a staff name for each extra ticket", () => {
    const r = parseStallOrder({ ...STALL, holderFirst1: "Tumi", holderLast1: "Sello" }, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["holderFirst2", "holderLast2"]);
  });
});

describe("holdersJson and orderRefusal", () => {
  it("writes the shape create_event_order() takes", () => {
    expect(holdersJson([{ firstName: "Neo", lastName: "Molefe" }])).toEqual([{ first_name: "Neo", last_name: "Molefe" }]);
  });

  it("turns the database's codes into sentences and hides anything else", () => {
    expect(orderRefusal('P0001: sold_out')).toMatch(/not enough tickets left/);
    expect(orderRefusal("tickets_closed")).toMatch(/not on sale/);
    expect(orderRefusal('duplicate key value violates unique constraint "x"')).toMatch(/try again in a moment/);
  });
});
