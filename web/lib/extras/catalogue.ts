/**
 * Which extras a child may order, and what they come to.
 *
 * Pure. The band rules decide what a family is shown and the arithmetic
 * decides what they will be asked to pay, and both are easier to argue with
 * here than on a page in front of a parent.
 */

export type ItemLike = {
  id: string;
  campus_id: string;
  grade_sort_min: number | null;
  grade_sort_max: number | null;
  amount_minor: number;
  currency: string;
  options: unknown;
  allow_quantity: boolean;
  order_by: string | null;
  is_active: boolean;
  sort_order: number;
};

export type SelectionLike = {
  item_id: string;
  quantity: number;
  unit_amount_minor: number;
  currency: string;
  status: "selected" | "paid" | "cancelled";
};

/**
 * What this child is offered.
 *
 * The same band convention as the document requirements and the fee
 * schedules: null on either end means no limit that side. A child with no
 * grade yet is shown only the items that apply to everyone — being shown a
 * Stage 6 stationery pack for a three-year-old is worse than being shown
 * nothing.
 */
export function applicableItems<T extends ItemLike>(
  items: readonly T[],
  where: { campusId: string; gradeSort: number | null }
): T[] {
  return items
    .filter((i) => i.is_active)
    .filter((i) => i.campus_id === where.campusId)
    .filter((i) => {
      if (i.grade_sort_min === null && i.grade_sort_max === null) return true;
      if (where.gradeSort === null) return false;
      if (i.grade_sort_min !== null && where.gradeSort < i.grade_sort_min) return false;
      if (i.grade_sort_max !== null && where.gradeSort > i.grade_sort_max) return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The options a parent picks from, whatever shape the column came back in. */
export function optionsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

/** An item whose order-by date has passed can be read about but not ordered. */
export function isOrderable(item: ItemLike, today: string): boolean {
  if (!item.is_active) return false;
  return item.order_by === null || today <= item.order_by;
}

export type Basket = { totalMinor: number; currency: string | null; lines: number };

/**
 * What a family owes for what they have chosen.
 *
 * Cancelled lines are excluded; paid ones are not, because the total is what
 * the order came to rather than what is still outstanding — those are
 * different questions and conflating them is how a receipt stops matching an
 * invoice.
 *
 * A basket that somehow mixes currencies returns a null currency rather than
 * a number: adding pula to rand produces a figure that is wrong in both, and
 * a page that shows it would be lying confidently.
 */
export function basketTotal(selections: readonly SelectionLike[]): Basket {
  const live = selections.filter((s) => s.status !== "cancelled");
  const currencies = new Set(live.map((s) => s.currency));
  const totalMinor = live.reduce((sum, s) => sum + s.unit_amount_minor * s.quantity, 0);
  return {
    totalMinor,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    lines: live.length,
  };
}

/**
 * What a family still owes: the same sum, minus what is already paid for.
 */
export function outstandingTotal(selections: readonly SelectionLike[]): Basket {
  return basketTotal(selections.filter((s) => s.status === "selected"));
}
