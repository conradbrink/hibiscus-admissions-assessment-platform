/**
 * Pure money checks shared by the reconciler and its tests. A payment is
 * only ever treated as made when what the provider says it took equals what
 * we asked for, to the minor unit and the currency.
 */
export function amountMatches(
  expected: { amount_minor: number; currency: string },
  actual: { amountMinor: number | null; currency: string | null }
): boolean {
  return (
    actual.amountMinor !== null &&
    Number.isInteger(actual.amountMinor) &&
    actual.amountMinor === Number(expected.amount_minor) &&
    (actual.currency ?? "").toUpperCase() === expected.currency.toUpperCase()
  );
}

/** "1500.00" for the wire; DPO amounts are decimal strings in major units. */
export function minorToDecimal(minor: number): string {
  const abs = Math.abs(Math.round(minor));
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Back from the wire; null for anything that is not a plain decimal. */
export function decimalToMinor(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
