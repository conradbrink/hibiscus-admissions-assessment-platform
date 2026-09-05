/**
 * Money is stored in minor units (thebe, cents) and only ever formatted for
 * display. Two currencies: Pula for Botswana campuses, Rand for Potch.
 *
 * Formatting is done by hand rather than through `toLocaleString`: the ICU
 * data on a server decides what "en-ZA" means, and an offer letter must read
 * the same everywhere. The house style is "P 2,500.00".
 */
export function formatMoney(minor: number, currency: string): string {
  const symbol = currency === "ZAR" ? "R" : "P";
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${symbol} ${whole}.${cents}`;
}

/**
 * Staff type amounts in the fee admin. Accepts "2500", "2,500", "2 500.50",
 * "P 48000.50" and "2500,50"; a comma followed by one or two digits at the
 * end, with no dot elsewhere, is a decimal mark; otherwise commas and spaces
 * are grouping. Rejects more than two decimals or a stray character.
 */
export function parseMoneyToMinor(input: string): number | null {
  let s = input.trim().replace(/^[A-Za-z]+\s*/, "").replace(/\s+/g, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s) && !s.includes(".")) s = s.replace(/,(\d{1,2})$/, ".$1");
  s = s.replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
