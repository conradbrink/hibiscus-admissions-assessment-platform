/**
 * Money is stored in minor units (thebe, cents) and only ever formatted for
 * display. Two currencies: Pula for Botswana campuses, Rand for Potch.
 */
export function formatMoney(minor: number, currency: string): string {
  const symbol = currency === "ZAR" ? "R" : "P";
  return `${symbol} ${(minor / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseMoneyToMinor(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
