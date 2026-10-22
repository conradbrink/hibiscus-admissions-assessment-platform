import { reminderDaysFromKey as reminderDaysOf, TOO_SOON_MS } from "@/lib/workflow/reminder-jobs";

/**
 * Moving a family's payment deadline, and the queued work that has to move
 * with it.
 *
 * The deadline itself is one column — `payment_requests.due_at` — and almost
 * everything a parent sees reads it live: the payment page prints "Due by",
 * every reminder email takes the date at send time, and the magic link's
 * lifetime is derived from it. So changing the column is genuinely enough for
 * the *words*.
 *
 * What it is not enough for is the clock. Accepting an offer queues three
 * kinds of job against the old date — an overdue sweep a minute after it, and
 * a reminder email at each of `payment_reminder_days_before` before it — and
 * those carry their own `run_after`. Move the column alone and the family is
 * told they are overdue on the old date while the new one is still weeks
 * away, which is worse than not moving it at all.
 *
 * Pure, so the arithmetic is tested rather than inferred from a staging run.
 * The caller does the reading and writing.
 */

/** A minute after the deadline, matching what `onOfferAccepted` queues. */
const OVERDUE_GRACE_MS = 60_000;

const DAY_MS = 86_400_000;

export type PendingPaymentJob = {
  id: string;
  type: string;
  idempotency_key: string;
};

export type JobMove =
  | { id: string; action: "reschedule"; runAfter: string }
  | { id: string; action: "skip"; reason: string };

/** The days-before a payment reminder's key encodes, or null if it encodes none. The key's shape lives with the code that builds it. */
export function reminderDaysFromKey(key: string): number | null {
  return reminderDaysOf(key, "payment_reminder");
}

/**
 * Where each pending job should sit once the deadline is `newDueAt`.
 *
 * A job whose new time has already passed is skipped rather than moved, with
 * one exception: the overdue sweep. Moving a deadline into the past is how
 * staff mark a family late on purpose, and a sweep dated in the past is one
 * the drain runs at once — which is the intent, not a mistake.
 */
export function rescheduleForDueDate(
  jobs: readonly PendingPaymentJob[],
  newDueAt: Date,
  now: Date = new Date()
): JobMove[] {
  const moves: JobMove[] = [];
  for (const job of jobs) {
    if (job.type === "payment_overdue") {
      moves.push({ id: job.id, action: "reschedule", runAfter: new Date(newDueAt.getTime() + OVERDUE_GRACE_MS).toISOString() });
      continue;
    }
    const days = reminderDaysFromKey(job.idempotency_key);
    if (days === null) continue;
    const at = new Date(newDueAt.getTime() - days * DAY_MS);
    if (at.getTime() <= now.getTime() + TOO_SOON_MS) {
      moves.push({ id: job.id, action: "skip", reason: `the deadline moved; ${days} days before it is no longer in the future` });
      continue;
    }
    moves.push({ id: job.id, action: "reschedule", runAfter: at.toISOString() });
  }
  return moves;
}
