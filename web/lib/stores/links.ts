/**
 * Where a stock movement's transaction lives. A reversal's line carries the
 * original's link as well as its own, so it opens the original, which shows
 * the reversal against it. Pure.
 */
export type MovementLinks = {
  movement_type: string;
  receipt_id: string | null;
  checkout_id: string | null;
  return_id: string | null;
  issue_id: string | null;
  assignment_id: string | null;
  asset_return_id?: string | null;
  adjustment_id: string | null;
};

export type TransactionKind = "receipt" | "checkout" | "return" | "issue" | "assignment" | "adjustment";

export const TRANSACTION_KINDS: readonly TransactionKind[] = ["receipt", "checkout", "return", "issue", "assignment", "adjustment"];

export function transactionHref(kind: TransactionKind, id: string): string {
  return `/staff/stores/transactions/${kind}/${id}`;
}

export function movementHref(m: MovementLinks): string | null {
  if (m.return_id) return transactionHref("return", m.return_id);
  if (m.receipt_id) return transactionHref("receipt", m.receipt_id);
  if (m.issue_id) return transactionHref("issue", m.issue_id);
  if (m.assignment_id) return transactionHref("assignment", m.assignment_id);
  if (m.adjustment_id && !m.checkout_id) return transactionHref("adjustment", m.adjustment_id);
  if (m.checkout_id) return transactionHref("checkout", m.checkout_id);
  if (m.adjustment_id) return transactionHref("adjustment", m.adjustment_id);
  return null;
}

/** The change a movement made to what is on the shelf, signed: "+5", "−2", "0". */
export function shelfChange(availableDelta: number): string {
  if (availableDelta > 0) return `+${availableDelta}`;
  if (availableDelta < 0) return `−${-availableDelta}`;
  return "0";
}
