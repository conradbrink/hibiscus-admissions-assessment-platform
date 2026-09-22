/**
 * A scholarship is a promotion, and this is how the rest of the system asks
 * whether a particular application holds one.
 *
 * Modelling the award as a promotion rather than a new concept means the fee
 * arithmetic, the waivers, the zero-payment acceptance and the letter's deal
 * text all come from machinery that already works. What it costs is this
 * file: somewhere to say "a promotion whose code starts `SCHOLARSHIP-` is an
 * award, and the number after the dash is what it is worth".
 *
 * The code is the contract. It is matched by prefix rather than by a list, so
 * next year's bands need a migration and nothing here.
 *
 * Pure, and deliberately free of `server-only`: a staff badge saying "50%"
 * is a client component, and the DB half lives next door in
 * `scholarship-server.ts`.
 */

const PREFIX = "SCHOLARSHIP-";

/** Whether a promotion code names a scholarship award. */
export function isScholarshipCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code.startsWith(PREFIX) && awardPercentOf(code) !== null;
}

/**
 * The award as a number, from the code. `SCHOLARSHIP-50` is 50.
 *
 * Null for anything that is not a well-formed award, which is what keeps
 * `isScholarshipCode` honest: a promotion called `SCHOLARSHIP-LAUNCH` is a
 * deal with an unfortunate name, not a 0% scholarship.
 */
export function awardPercentOf(code: string | null | undefined): number | null {
  if (typeof code !== "string" || !code.startsWith(PREFIX)) return null;
  const tail = code.slice(PREFIX.length);
  if (!/^\d{1,3}$/.test(tail)) return null;
  const percent = Number(tail);
  return percent > 0 && percent <= 100 ? percent : null;
}

/** How the award reads to a parent: "50%". */
export function awardLabelOf(code: string | null | undefined): string | null {
  const percent = awardPercentOf(code);
  return percent === null ? null : `${percent}%`;
}

export type ScholarshipFacts = {
  /** The promotion code, e.g. `SCHOLARSHIP-50`. */
  code: string;
  /** "50%", for the letter and the WhatsApp. */
  award: string;
  /**
   * Tuition for one term after the award, formatted — "P9,495" — or null when
   * the campus and grade have no priced schedule yet. Null rather than zero,
   * because a letter saying a term costs nothing would be a worse lie than
   * one that omits the figure.
   */
  tuitionPerTerm: string | null;
};

