/**
 * The money on one child's transport line, and the totals finance reads.
 *
 * Every figure comes from the line's frozen snapshot (`amount_minor`, and the
 * provider's share in `transport_rider_provider_shares`), the refunds
 * recorded on it and the payout items that name it. Nothing is re-priced here.
 *
 * The rules, per child on a booking the parent paid:
 *
 *   paid by the parent   = the line's amount
 *   refunded             = what finance recorded as refunded
 *   provider's share     = still booked: the provider's amount
 *                          cancelled: what was charged for it, less any credit
 *                          (nothing, if it was cancelled before it was charged)
 *   paid to provider     = its charge, less its credit
 *   still owed           = still booked and not yet charged: the provider's amount
 *   credit to decide     = cancelled, charged and not credited: the most a
 *                          credit could be. A ceiling, not a debt — finance
 *                          and the provider agree what is credited.
 *   Hibiscus keeps       = paid − refunded − provider's share
 *
 * So the provider's share less what it was paid is always what is still owed,
 * which `ledger.test.ts` checks for every state a line can be in.
 *
 * Pure: the pages and the downloads total the same lines the same way.
 */

export type LedgerItem = { kind: "charge" | "credit"; amountMinor: number };

export type LedgerRider = {
  id: string;
  bookingId: string;
  /** The booking was paid (its `paid_at` is set), whatever happened after. */
  bookingPaid: boolean;
  status: "booked" | "cancelled";
  amountMinor: number;
  providerAmountMinor: number;
  refundMinor: number;
  items: readonly LedgerItem[];
};

export type LedgerFigures = {
  paidByParent: number;
  refunded: number;
  providerShare: number;
  paidToProvider: number;
  owedToProvider: number;
  creditToDecide: number;
  hibiscusKeeps: number;
};

export type LedgerTotals = LedgerFigures & {
  /** Children still booked. */
  children: number;
  /** Children cancelled after their booking was paid. */
  cancelled: number;
  bookings: number;
};

const ZERO: LedgerFigures = { paidByParent: 0, refunded: 0, providerShare: 0, paidToProvider: 0, owedToProvider: 0, creditToDecide: 0, hibiscusKeeps: 0 };

export function ledgerLine(r: LedgerRider): LedgerFigures {
  // Money that never arrived is not earnings: an unpaid booking's lines are
  // shown as awaiting payment, not counted here.
  if (!r.bookingPaid) return { ...ZERO };
  const charged = r.items.filter((i) => i.kind === "charge").reduce((s, i) => s + i.amountMinor, 0);
  const credited = r.items.filter((i) => i.kind === "credit").reduce((s, i) => s + i.amountMinor, 0);
  const hasCredit = r.items.some((i) => i.kind === "credit");

  const booked = r.status === "booked";
  const providerShare = booked ? r.providerAmountMinor : charged - credited;
  const owedToProvider = booked && charged === 0 ? r.providerAmountMinor : 0;
  const creditToDecide = !booked && charged > 0 && !hasCredit ? charged : 0;
  return {
    paidByParent: r.amountMinor,
    refunded: r.refundMinor,
    providerShare,
    paidToProvider: charged - credited,
    owedToProvider,
    creditToDecide,
    hibiscusKeeps: r.amountMinor - r.refundMinor - providerShare,
  };
}

export function ledgerTotals(riders: readonly LedgerRider[]): LedgerTotals {
  const totals: LedgerTotals = { ...ZERO, children: 0, cancelled: 0, bookings: 0 };
  const bookings = new Set<string>();
  for (const r of riders) {
    if (!r.bookingPaid) continue;
    const f = ledgerLine(r);
    for (const k of Object.keys(ZERO) as Array<keyof LedgerFigures>) totals[k] += f[k];
    if (r.status === "booked") totals.children += 1;
    else totals.cancelled += 1;
    bookings.add(r.bookingId);
  }
  totals.bookings = bookings.size;
  return totals;
}

/** Totals by a key (a school, a period), in the order the keys first appear in `riders`. */
export function ledgerBy<R extends LedgerRider>(riders: readonly R[], key: (r: R) => string): Array<{ key: string; totals: LedgerTotals }> {
  const groups = new Map<string, R[]>();
  for (const r of riders) {
    if (!r.bookingPaid) continue;
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([k, rs]) => ({ key: k, totals: ledgerTotals(rs) }));
}
