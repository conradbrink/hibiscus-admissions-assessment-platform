import { describe, expect, it } from "vitest";
import { ledgerBy, ledgerLine, ledgerTotals, providerShareOf, type LedgerRider } from "@/lib/transport/ledger";

// The worked example's Broadhurst child: P 4,250.00 to the parent, P 3,726.43
// owed to the provider (the "same school" Gaborone full shuttle, a term).
const line = (over: Partial<LedgerRider> = {}): LedgerRider => ({
  id: "r1",
  bookingId: "b1",
  bookingPaid: true,
  status: "booked",
  amountMinor: 425000,
  providerAmountMinor: 372643,
  refundMinor: 0,
  items: [],
  ...over,
});

const charge = { kind: "charge" as const, amountMinor: 372643 };

describe("ledgerLine", () => {
  it("a booked child not yet paid for: the provider is owed its whole amount", () => {
    expect(ledgerLine(line())).toEqual({
      paidByParent: 425000,
      refunded: 0,
      providerShare: 372643,
      paidToProvider: 0,
      owedToProvider: 372643,
      creditToDecide: 0,
      hibiscusKeeps: 52357,
    });
  });

  it("a booked child already paid for: nothing is owed", () => {
    const f = ledgerLine(line({ items: [charge] }));
    expect(f.paidToProvider).toBe(372643);
    expect(f.owedToProvider).toBe(0);
    expect(f.hibiscusKeeps).toBe(52357);
  });

  it("cancelled before the provider was paid: the provider's share is nothing, and Hibiscus keeps what was not refunded", () => {
    const f = ledgerLine(line({ status: "cancelled", refundMinor: 400000 }));
    expect(f.providerShare).toBe(0);
    expect(f.owedToProvider).toBe(0);
    expect(f.creditToDecide).toBe(0);
    expect(f.hibiscusKeeps).toBe(25000);
  });

  it("cancelled after the provider was paid, no credit yet: a credit of up to the charge is still to decide", () => {
    const f = ledgerLine(line({ status: "cancelled", refundMinor: 100000, items: [charge] }));
    expect(f.providerShare).toBe(372643);
    expect(f.creditToDecide).toBe(372643);
    expect(f.hibiscusKeeps).toBe(425000 - 100000 - 372643);
  });

  it("cancelled, paid for and partly credited: the credit comes off the share and nothing is left to decide", () => {
    const f = ledgerLine(line({ status: "cancelled", refundMinor: 200000, items: [charge, { kind: "credit", amountMinor: 100000 }] }));
    expect(f.providerShare).toBe(272643);
    expect(f.paidToProvider).toBe(272643);
    expect(f.creditToDecide).toBe(0);
    expect(f.hibiscusKeeps).toBe(425000 - 200000 - 272643);
  });

  it("an unpaid booking counts for nothing", () => {
    expect(Object.values(ledgerLine(line({ bookingPaid: false, items: [] })))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("the provider's share less what it was paid is what is still owed, in every state", () => {
    const states: LedgerRider[] = [
      line(),
      line({ items: [charge] }),
      line({ status: "cancelled" }),
      line({ status: "cancelled", items: [charge] }),
      line({ status: "cancelled", items: [charge, { kind: "credit", amountMinor: 372643 }] }),
      line({ status: "cancelled", refundMinor: 425000, items: [charge, { kind: "credit", amountMinor: 1 }] }),
    ];
    for (const s of states) {
      const f = ledgerLine(s);
      expect(f.providerShare - f.paidToProvider).toBe(f.owedToProvider);
      expect(f.paidByParent - f.refunded - f.providerShare).toBe(f.hibiscusKeeps);
    }
  });
});

describe("providerShareOf", () => {
  it("is the line's own share, booking paid or not, and what the ledger counts once it is", () => {
    const shapes = [
      line(),
      line({ items: [charge] }),
      line({ status: "cancelled" }),
      line({ status: "cancelled", items: [charge] }),
      line({ status: "cancelled", items: [charge, { kind: "credit", amountMinor: 100000 }] }),
    ];
    expect(shapes.map(providerShareOf)).toEqual([372643, 372643, 0, 372643, 272643]);
    for (const r of shapes) expect(providerShareOf(r)).toBe(ledgerLine(r).providerShare);
    // The booking page shows it on an unpaid booking too, where the ledger counts nothing.
    expect(providerShareOf(line({ bookingPaid: false }))).toBe(372643);
  });
});

describe("ledgerTotals and ledgerBy", () => {
  // The worked example: two at Broadhurst, one at Block 7. P 12,900.00 in, P 11,277.79 to the provider.
  const example: Array<LedgerRider & { school: string }> = [
    { ...line({ id: "a" }), school: "Broadhurst" },
    { ...line({ id: "b" }), school: "Broadhurst" },
    { ...line({ id: "c", amountMinor: 440000, providerAmountMinor: 382493 }), school: "Block 7" },
  ];

  it("adds the worked example up to the sheet's figures", () => {
    const t = ledgerTotals(example);
    expect(t.paidByParent).toBe(1290000);
    expect(t.providerShare).toBe(1127779);
    expect(t.hibiscusKeeps).toBe(162221);
    expect(t.owedToProvider).toBe(1127779);
    expect(t).toMatchObject({ children: 3, cancelled: 0, bookings: 1 });
  });

  it("leaves unpaid bookings out of the totals and the counts", () => {
    const t = ledgerTotals([...example, { ...line({ id: "d", bookingId: "b2", bookingPaid: false }), school: "Broadhurst" }]);
    expect(t.bookings).toBe(1);
    expect(t.children).toBe(3);
  });

  it("groups by school in the order the schools first appear", () => {
    const groups = ledgerBy(example, (r) => r.school);
    expect(groups.map((g) => [g.key, g.totals.paidByParent, g.totals.children])).toEqual([
      ["Broadhurst", 850000, 2],
      ["Block 7", 440000, 1],
    ]);
  });
});
