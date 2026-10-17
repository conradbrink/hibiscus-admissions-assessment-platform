/**
 * When an unpaid booking expires, and when a finished booking's people are
 * removed. Pure, so the sweeps (`lib/workflow/automation/transport.ts`,
 * `retention.ts`) and the tests read the same rule.
 */

export type ExpiryCandidate = { id: string; status: string; created_at: string; has_payment_in_flight: boolean };

/**
 * Unpaid for longer than the window, with nobody on the gateway's page right
 * now. A booking whose parent is mid-payment waits for that payment's own
 * time limit, which the reconciler keeps.
 */
export function unpaidExpiryDue(rows: readonly ExpiryCandidate[], unpaidHours: number, now: Date = new Date()): string[] {
  const cutoff = now.getTime() - unpaidHours * 3_600_000;
  return rows
    .filter((r) => r.status === "awaiting_payment" && !r.has_payment_in_flight && new Date(r.created_at).getTime() < cutoff)
    .map((r) => r.id);
}

export type RetentionCandidate = { id: string; status: string; updated_at: string; period_ends_on: string; anonymised_at: string | null };

/**
 * Paid and cancelled bookings go a set number of days after their period
 * ends: the finance report and the payouts need the figures, not the names,
 * and the figures stay. Expired and abandoned ones, which nobody ever rode
 * on, go sooner, counted from when they stopped.
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
      r.status === "paid" || r.status === "cancelled"
        ? r.period_ends_on < periodCutoff
        : r.status === "expired" || r.status === "abandoned"
          ? new Date(r.updated_at).getTime() < unpaidCutoff
          : false
    )
    .map((r) => r.id);
}
