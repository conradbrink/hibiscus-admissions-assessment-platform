/**
 * The storeroom's rules that a screen needs to agree with the database on:
 * what to call an item's state, when a loan is due or overdue, the words for
 * each kind of movement and condition, and the default return date.
 *
 * Pure, with no Supabase, Next or React import, so the tests can hold them
 * and both the server and the browser can use them.
 */

export type ItemType = "reusable" | "consumable" | "asset";
export type Condition = "good" | "damaged" | "missing_parts" | "needs_maintenance";
export type MovementType =
  | "received" | "checked_out" | "returned" | "issued" | "assigned"
  | "asset_returned" | "adjustment" | "transfer" | "reversal";
export type AdjustmentKind = "count_correction" | "mark_damaged" | "repaired" | "write_off" | "write_off_outstanding";
export type Tone = "success" | "warning" | "destructive" | "info" | "muted" | "secondary";

export const ITEM_TYPES: readonly ItemType[] = ["reusable", "consumable", "asset"];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  reusable: "Reusable equipment",
  consumable: "Consumable",
  asset: "Permanently assigned asset",
};

/** One line under each type when it is chosen, so nobody has to guess. */
export const ITEM_TYPE_HINTS: Record<ItemType, string> = {
  reusable: "Goes out and comes back: speakers, projectors, balls. Checked out and in, with a signature each way.",
  consumable: "Used up: cleaning chemicals, paper, refuse bags. Issued and deducted, never returned.",
  asset: "Leaves the storeroom for good but stays the school's: assigned to a department or a person.",
};

export const CONDITIONS: readonly Condition[] = ["good", "damaged", "missing_parts", "needs_maintenance"];

export const CONDITION_LABELS: Record<Condition, string> = {
  good: "Good",
  damaged: "Damaged",
  missing_parts: "Missing parts",
  needs_maintenance: "Requires maintenance",
};

export const MOVEMENT_TYPES: readonly MovementType[] = [
  "received", "checked_out", "returned", "issued", "assigned", "asset_returned", "adjustment", "transfer", "reversal",
];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  received: "Stock Received",
  checked_out: "Equipment Checked Out",
  returned: "Equipment Returned",
  issued: "Consumable Issued",
  assigned: "Asset Assigned",
  asset_returned: "Asset Returned to Storeroom",
  adjustment: "Stock Adjustment",
  transfer: "Stock Transfer",
  reversal: "Reversal",
};

export const MOVEMENT_TONE: Record<MovementType, Tone> = {
  received: "success",
  checked_out: "info",
  returned: "success",
  issued: "secondary",
  assigned: "info",
  asset_returned: "success",
  adjustment: "warning",
  transfer: "secondary",
  reversal: "destructive",
};

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  count_correction: "Count correction",
  mark_damaged: "Found damaged",
  repaired: "Repaired",
  write_off: "Written off",
  write_off_outstanding: "Written off while on loan",
};

export type ItemBalances = {
  item_type: ItemType;
  qty_available: number;
  qty_checked_out: number;
  qty_assigned: number;
  qty_unavailable: number;
  min_stock: number;
  is_active?: boolean;
};

export type ItemStatus = "available" | "partially_available" | "checked_out" | "low_stock" | "out_of_stock";

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  available: "Available",
  partially_available: "Partially Available",
  checked_out: "Checked Out",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
};

export const ITEM_STATUS_TONE: Record<ItemStatus, Tone> = {
  available: "success",
  partially_available: "info",
  checked_out: "warning",
  low_stock: "warning",
  out_of_stock: "destructive",
};

/**
 * The one label an item carries in the register.
 *
 * Read in order: nothing on the shelf is "Checked Out" when it is all on
 * loan and "Out of Stock" otherwise; something on the shelf at or under the
 * reorder level is "Low Stock"; equipment with some of it out is "Partially
 * Available"; the rest is "Available".
 */
export function itemStatus(item: ItemBalances): ItemStatus {
  if (item.qty_available <= 0) {
    return item.qty_checked_out > 0 && item.qty_unavailable === 0 && item.qty_assigned === 0 ? "checked_out" : "out_of_stock";
  }
  if (item.min_stock > 0 && item.qty_available <= item.min_stock) return "low_stock";
  if (item.item_type !== "consumable" && item.qty_checked_out + item.qty_assigned + item.qty_unavailable > 0) return "partially_available";
  return "available";
}

export function totalOf(item: Pick<ItemBalances, "qty_available" | "qty_checked_out" | "qty_assigned" | "qty_unavailable">): number {
  return item.qty_available + item.qty_checked_out + item.qty_assigned + item.qty_unavailable;
}

/** A calendar date, YYYY-MM-DD, in the school's zone. */
export type DateString = string;

/** Whole days from `a` to `b`, both calendar dates. */
export function daysBetween(a: DateString, b: DateString): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: DateString, n: number): DateString {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 Sunday … 6 Saturday, for a calendar date. */
export function weekday(day: DateString): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export type DueState = { state: "overdue" | "due_soon" | "on_loan"; tone: Tone; label: string; days: number };

/**
 * Where a loan stands: overdue once its date has passed (red), due soon
 * within `soonDays` (amber), on loan otherwise (neutral). The database's
 * `v_stores_outstanding.is_overdue` is the same rule; this is the words.
 */
export function dueState(expected: DateString, today: DateString, soonDays = 2): DueState {
  const days = daysBetween(today, expected);
  if (days < 0) {
    const late = -days;
    return { state: "overdue", tone: "destructive", label: late === 1 ? "Overdue by 1 day" : `Overdue by ${late} days`, days };
  }
  if (days <= soonDays) {
    return { state: "due_soon", tone: "warning", label: days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`, days };
  }
  return { state: "on_loan", tone: "secondary", label: `Due in ${days} days`, days };
}

/** The next weekday after `today`: the default return date for a checkout. */
export function nextSchoolDay(today: DateString): DateString {
  let d = addDays(today, 1);
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
  return d;
}

/** This week's Friday, or next week's when today is Friday or the weekend. */
export function endOfWeek(today: DateString): DateString {
  let d = addDays(today, 1);
  while (weekday(d) !== 5) d = addDays(d, 1);
  return d;
}

/** The one-tap return dates on the checkout screen. */
export function quickReturnDates(today: DateString): Array<{ label: string; date: DateString }> {
  const options = [
    { label: "Today", date: today },
    { label: "Next school day", date: nextSchoolDay(today) },
    { label: "Friday", date: endOfWeek(today) },
    { label: "In 1 week", date: addDays(today, 7) },
    { label: "In 2 weeks", date: addDays(today, 14) },
  ];
  // Two chips for one date say the same thing twice.
  const seen = new Set<string>();
  return options.filter((o) => (seen.has(o.date) ? false : (seen.add(o.date), true)));
}

/** "2 × Portable Speaker", "5 litres Floor Cleaner". */
export function quantityLine(quantity: number, name: string, unit: string): string {
  const u = unit.trim().toLowerCase();
  if (!u || u === "each" || u === "item" || u === "items" || u === "unit" || u === "units") return `${quantity} × ${name}`;
  return `${quantity} ${u} ${name}`;
}

/** Item lines as the database functions take them, with two lines for one item added together. */
export function mergeLines<T extends { item_id: string; quantity: number }>(lines: readonly T[]): Array<{ item_id: string; quantity: number }> {
  const out = new Map<string, number>();
  for (const l of lines) if (l.quantity > 0) out.set(l.item_id, (out.get(l.item_id) ?? 0) + l.quantity);
  return [...out.entries()].map(([item_id, quantity]) => ({ item_id, quantity }));
}

/**
 * What a refusal from the database means to the person at the screen.
 *
 * The functions raise their own plain sentences, which are shown as they
 * are. What is left is Postgres talking about itself: a missing grant, a
 * unique index, a check constraint. Those get a sentence too, so nobody is
 * shown "permission denied for table stores_items".
 */
export function storesErrorMessage(error: { message?: string; code?: string } | null | undefined): string {
  const message = (error?.message ?? "").trim();
  const code = error?.code ?? "";
  if (!message) return "Something went wrong. Please try again.";
  if (code === "42501" && /permission denied for/i.test(message)) return "You do not have permission to do that.";
  if (/duplicate key value/i.test(message)) {
    if (/employee/i.test(message) && /number/i.test(message)) return "Another employee already has that employee number.";
    return "That name is already in use. Choose another.";
  }
  if (code === "23503" || /violates foreign key/i.test(message)) return "That record is in use and cannot be removed. Switch it off instead.";
  if (/violates check constraint/i.test(message)) return "Some of what was entered is not valid. Check the form and try again.";
  if (/JWT|jwt expired/i.test(message)) return "Your sign-in has expired. Reload the page and sign in again.";
  return message;
}
