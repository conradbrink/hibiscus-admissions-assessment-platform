/**
 * A staff discount is a promotion, as a scholarship is, and this is how the
 * rest of the system knows one when it sees it.
 *
 * Added on the school's request of 20 October 2026: a 5% selection on the
 * offer, off tuition only. The arithmetic, the letter's deal lines and the
 * snapshot come from the promotion machinery; what this file adds is the
 * contract, `DISCOUNT-<n>` is n% off tuition, given by staff and only by staff.
 *
 * Only by staff because a promotion with a code is otherwise open to anyone
 * who types the code on the enquiry form (`promotionForCode`,
 * `resolvePromotion`), and one without a code is applied by rule to every
 * family it matches. Both of those refuse a staff discount code.
 *
 * Pure, and free of `server-only`, like `scholarship.ts`: the offer editor is
 * a client of it.
 */

const PREFIX = "DISCOUNT-";

/** The discount as a number, from the code. `DISCOUNT-5` is 5; anything else is null. */
export function discountPercentOf(code: string | null | undefined): number | null {
  if (typeof code !== "string" || !code.startsWith(PREFIX)) return null;
  const tail = code.slice(PREFIX.length);
  if (!/^\d{1,2}$/.test(tail)) return null;
  const percent = Number(tail);
  return percent > 0 && percent < 100 ? percent : null;
}

/** Whether a promotion code names a staff discount. */
export function isStaffDiscountCode(code: string | null | undefined): code is string {
  return discountPercentOf(code) !== null;
}

/** How the discount reads on the staff screens: "5% off tuition". */
export function discountLabelOf(code: string | null | undefined): string | null {
  const percent = discountPercentOf(code);
  return percent === null ? null : `${percent}% off tuition`;
}
