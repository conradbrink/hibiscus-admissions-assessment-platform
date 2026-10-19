/**
 * The school transport price rule, for the estimate a parent sees while they
 * type and for the staff reports.
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
 *   provider gets  = list × (1 − rebate) × (1 + VAT) × d / (5 × m)
 *
 * Totals are sums of the lines and are never rounded again.
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

// BigInt through a constructor, not literals: the build targets ES2017. The
// intermediate products reach 10^15 for an ordinary tariff, close enough to
// Number's exact range that a dearer one would round wrongly in silence.
const B = (n: number) => BigInt(n);

/** rhu(p, q) = (2p + q) div 2q, for p ≥ 0 and q > 0. */
function roundHalfUp(p: bigint, q: bigint): bigint {
  return (B(2) * p + q) / (B(2) * q);
}

export type LineInputs = {
  customerTermMinor: number;
  providerListTermMinor: number;
  rebateBp: number;
  vatBp: number;
  /** Weekdays chosen, 1 to 5. */
  days: number;
  /** 1 for a term; the term's months (3) for one month. */
  divisor: number;
};

export type PricedLine = {
  amountMinor: number;
  providerAmountMinor: number;
  /** What Hibiscus keeps: the parent's amount less the provider's. */
  retainedMinor: number;
};

export function priceLine(input: LineInputs): PricedLine {
  const { customerTermMinor, providerListTermMinor, rebateBp, vatBp, days, divisor } = input;
  if (!Number.isInteger(days) || days < 1 || days > 5) throw new Error("A child rides on one to five weekdays.");
  if (!Number.isInteger(divisor) || divisor < 1) throw new Error("A period divides the term by a whole number of months.");
  const amount = roundHalfUp(B(customerTermMinor) * B(days), B(5) * B(divisor));
  const provider = roundHalfUp(
    B(providerListTermMinor) * B(10000 - rebateBp) * B(10000 + vatBp) * B(days),
    B(100000000) * B(5) * B(divisor)
  );
  return { amountMinor: Number(amount), providerAmountMinor: Number(provider), retainedMinor: Number(amount - provider) };
}

/** The provider's nett for a whole term, five days: what the sheet calls "Watermark Nett". */
export function providerTermNettMinor(providerListTermMinor: number, rebateBp: number, vatBp: number): number {
  return priceLine({ customerTermMinor: 1, providerListTermMinor, rebateBp, vatBp, days: 5, divisor: 1 }).providerAmountMinor;
}

/** The VAT inside an amount that includes it: amount × vat / (1 + vat), rounded half up. */
export function vatWithinMinor(amountMinor: number, vatBp: number): number {
  return Number(roundHalfUp(B(amountMinor) * B(vatBp), B(10000 + vatBp)));
}

export type TariffLike = {
  id: string;
  zone_id: string;
  service: TariffService;
  household: Household;
  customer_term_minor: number;
  provider_list_term_minor: number;
};

export type EstimateRider = { campusId: string; service: RiderService; days: number };

export type Estimate = {
  lines: Array<PricedLine & { household: Household }>;
  totalMinor: number;
  providerTotalMinor: number;
};

/**
 * Every child on a booking, priced. Null when a tariff is missing, which the
 * booking function would refuse too (`transport_no_tariff`).
 */
export function estimateBooking(opts: {
  zoneId: string;
  divisor: number;
  rebateBp: number;
  vatBp: number;
  tariffs: readonly TariffLike[];
  riders: readonly EstimateRider[];
}): Estimate | null {
  if (opts.riders.length === 0) return null;
  const households = householdsFor(opts.riders.map((r) => r.campusId));
  const lines: Estimate["lines"] = [];
  for (const [i, rider] of opts.riders.entries()) {
    const household = households[i];
    const tariff = opts.tariffs.find(
      (t) => t.zone_id === opts.zoneId && t.service === tariffService(rider.service) && t.household === household
    );
    if (!tariff || rider.days < 1) return null;
    const line = priceLine({
      customerTermMinor: tariff.customer_term_minor,
      providerListTermMinor: tariff.provider_list_term_minor,
      rebateBp: opts.rebateBp,
      vatBp: opts.vatBp,
      days: rider.days,
      divisor: opts.divisor,
    });
    lines.push({ ...line, household });
  }
  return {
    lines,
    totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0),
    providerTotalMinor: lines.reduce((sum, l) => sum + l.providerAmountMinor, 0),
  };
}

/**
 * What the parent's browser is given to work the estimate out: the parent's
 * price and nothing of the provider's. The provider's own price is the
 * school's business with Watermark, and a public page is not the place for it.
 * Since 19 October 2026 it is not in the tariffs at all (it is finance's,
 * in `transport_tariff_provider_prices`); this still copies only the four
 * fields, so nothing added to a tariff later reaches the browser by default.
 */
export type CustomerTariff = Pick<TariffLike, "zone_id" | "service" | "household" | "customer_term_minor">;

export function customerTariffs(tariffs: readonly CustomerTariff[]): CustomerTariff[] {
  return tariffs.map(({ zone_id, service, household, customer_term_minor }) => ({ zone_id, service, household, customer_term_minor }));
}

/** The parent's side of `estimateBooking`, from customer tariffs only. Same rounding, same rule. */
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
    const amount = roundHalfUp(B(tariff.customer_term_minor) * B(rider.days), B(5) * B(opts.divisor));
    lines.push({ amountMinor: Number(amount), household: households[i] });
  }
  return { lines, totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0) };
}
