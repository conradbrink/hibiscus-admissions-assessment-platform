/**
 * When an unpaid booking expires, and when a finished booking's people are
 * removed. Pure, so the sweeps (`lib/workflow/automation/transport.ts`,
 * `retention.ts`) and the tests read the same rule.
 */

export type ExpiryCandidate = {
  id: string;
  status: string;
  created_at: string;
  /** A payment in flight on the gateway, or one that succeeded. */
  has_live_payment: boolean;
  /** The open request's pay-by date, when there is one. */
  due_at: string | null;
};

/**
 * Unpaid for longer than the window, or past the date the parent was told to
 * pay by (the request's `due_at`: the window's end, or the day booking closes
 * for the period if that comes first), with nobody on the gateway's page right
 * now. A booking whose parent is mid-payment waits for that payment's own
 * time limit, which the reconciler keeps; one that money reached is never
 * expired by the clock.
 */
export function unpaidExpiryDue(rows: readonly ExpiryCandidate[], unpaidHours: number, now: Date = new Date()): string[] {
  const cutoff = now.getTime() - unpaidHours * 3_600_000;
  const late = (r: ExpiryCandidate) => new Date(r.created_at).getTime() < cutoff || (r.due_at !== null && new Date(r.due_at).getTime() < now.getTime());
  return rows.filter((r) => r.status === "awaiting_payment" && !r.has_live_payment && late(r)).map((r) => r.id);
}

export type RetentionCandidate = {
  id: string;
  status: string;
  /** Set once money arrived, whatever happened to the booking after. */
  paid_at: string | null;
  updated_at: string;
  period_ends_on: string;
  anonymised_at: string | null;
};

/**
 * Bookings that were paid go a set number of days after their period ends,
 * cancelled or not: the finance report and the payouts need the figures, not
 * the names, and the figures stay. Expired and abandoned ones, and ones
 * cancelled before they were paid, which nobody ever paid for or rode on, go
 * sooner, counted from when they stopped.
 */
export function transportRetentionDue(
  rows: readonly RetentionCandidate[],
  settings: { transportRetentionDays: number; transportUnpaidRetentionDays: number },
  today: string,
  now: Date = new Date()
): string[] {
  const daysBefore = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const periodCutoff = daysBefore(settings.transportRetentionDays);
  const unpaidCutoff = now.getTime() - settings.transportUnpaidRetentionDays * 86_400_000;
  return rows
    .filter((r) => r.anonymised_at === null)
    .filter((r) =>
      r.status === "paid" || (r.status === "cancelled" && r.paid_at !== null)
        ? r.period_ends_on < periodCutoff
        : r.status === "expired" || r.status === "abandoned" || r.status === "cancelled"
          ? new Date(r.updated_at).getTime() < unpaidCutoff
          : false
    )
    .map((r) => r.id);
}
