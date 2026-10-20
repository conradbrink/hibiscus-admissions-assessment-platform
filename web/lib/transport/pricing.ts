/**
 * The parent's side of the school transport price rule, for the estimate a
 * parent sees while they type.
 *
 * What a parent is charged is worked out by `create_transport_booking()` in
 * the database and written onto each child's row; this is the same rule, so
 * the estimate on the form and the amount on the payment page agree. Both are
 * pinned to the figures on the school's sheet — here in `pricing.test.ts`, and
 * there by the migration's own check and security case 83 — so a change to
 * one that the other does not share fails a test rather than a parent.
 *
 * Per child, in whole thebe, rounded half up once:
 *
 *   d = weekdays chosen (1 to 5); m = 1 for a term, the term's months for a month
 *   parent pays    = term price × d / (5 × m)
 *
 * Totals are sums of the lines and are never rounded again. The provider's
 * side of the rule is the database's alone (`create_transport_booking()` and
 * `transport_rider_share_guard()`), as its prices are finance's: nothing here
 * knows them.
 *
 * Pure and free of `server-only`, so the booking form (a client component)
 * and the tests can both import it.
 */

export type Household = "single" | "different_schools" | "same_school";
export type RiderService = "full" | "am" | "pm";
export type TariffService = "full" | "one_way";

/** Morning only and afternoon only are each the sheet's one-way price. */
export function tariffService(service: RiderService): TariffService {
  return service === "full" ? "full" : "one_way";
}

/**
 * The sibling rate for each child, counting the children on one booking: one
 * child alone; otherwise "same school" for a child who shares a school with
 * another child on the booking, and "different schools" for a child who is
 * the only one at theirs. Two at Broadhurst and one at Block 7 is two
 * same-school children and one different-schools child.
 */
export function householdsFor(campusIds: readonly string[]): Household[] {
  if (campusIds.length === 1) return ["single"];
  return campusIds.map((id) => (campusIds.filter((other) => other === id).length > 1 ? "same_school" : "different_schools"));
}

// BigInt through a constructor, not literals: the build targets ES2017.
// Whole-number arithmetic, as the database's, so the two round alike.
const B = (n: number) => BigInt(n);

/** rhu(p, q) = (2p + q) div 2q, for p ≥ 0 and q > 0. */
function roundHalfUp(p: bigint, q: bigint): bigint {
  return (B(2) * p + q) / (B(2) * q);
}

/** One child's line: the term price for `days` weekdays, divided over `divisor` months. */
export function customerLineMinor(customerTermMinor: number, days: number, divisor: number): number {
  if (!Number.isInteger(days) || days < 1 || days > 5) throw new Error("A child rides on one to five weekdays.");
  if (!Number.isInteger(divisor) || divisor < 1) throw new Error("A period divides the term by a whole number of months.");
  return Number(roundHalfUp(B(customerTermMinor) * B(days), B(5) * B(divisor)));
}

export type EstimateRider = { campusId: string; service: RiderService; days: number };

/**
 * What the parent's browser is given to work the estimate out: the parent's
 * price and nothing of the provider's. The provider's own price is the
 * school's business with Watermark, and a public page is not the place for it.
 * Since 19 October 2026 it is not in the tariffs at all (it is finance's,
 * in `transport_tariff_provider_prices`); this still copies only the four
 * fields, so nothing added to a tariff later reaches the browser by default.
 */
export type CustomerTariff = { zone_id: string; service: TariffService; household: Household; customer_term_minor: number };

export function customerTariffs(tariffs: readonly CustomerTariff[]): CustomerTariff[] {
  return tariffs.map(({ zone_id, service, household, customer_term_minor }) => ({ zone_id, service, household, customer_term_minor }));
}

/**
 * Every child on a booking, priced from customer tariffs only. Null when a
 * tariff is missing or a day count is out of range, which the booking
 * function would refuse too (`transport_no_tariff`).
 */
export function estimateCustomerTotal(opts: {
  zoneId: string;
  divisor: number;
  tariffs: readonly CustomerTariff[];
  riders: readonly EstimateRider[];
}): { lines: Array<{ amountMinor: number; household: Household }>; totalMinor: number } | null {
  if (opts.riders.length === 0) return null;
  const households = householdsFor(opts.riders.map((r) => r.campusId));
  const lines: Array<{ amountMinor: number; household: Household }> = [];
  for (const [i, rider] of opts.riders.entries()) {
    const tariff = opts.tariffs.find(
      (t) => t.zone_id === opts.zoneId && t.service === tariffService(rider.service) && t.household === households[i]
    );
    if (!tariff || rider.days < 1 || rider.days > 5) return null;
    lines.push({ amountMinor: customerLineMinor(tariff.customer_term_minor, rider.days, opts.divisor), household: households[i] });
  }
  return { lines, totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0) };
}
