import type { Json } from "@/lib/supabase/types";
import type { JobPrecondition, JobSpec } from "@/lib/workflow/engine";

/**
 * The reminder emails before a deadline, built in one place.
 *
 * Offer approval, acceptance and a moved deadline each queue them, and the
 * Payments page reschedules them by reading the days back out of the key
 * (`reminderDaysFromKey`). When each caller spelled the key itself, a moved
 * deadline's reminders came out as `…:7d:2026-12-05`, the reader expected the
 * key to end at `7d`, and the next move left them on the old schedule. The
 * shape lives here now, beside the rule for reading it.
 *
 * Pure, so vitest covers it.
 */

const DAY = 86_400_000;

/**
 * Inside this much of now, a reminder is not worth queueing: it would land
 * alongside the email it is reminding about, or the one announcing a new
 * date. Shared with `rescheduleForDueDate`, so a reminder the queueing code
 * would have declined to create is one a move declines to keep.
 */
export const TOO_SOON_MS = 15 * 60_000;

export type ReminderTemplate = "offer_reminder" | "payment_reminder";

/**
 * `email:<application>:<template>:<offer or request>:<n>d`, with `:<suffix>`
 * when a deadline move queued it: a moved deadline's reminders are new jobs,
 * and the outbox refuses a key it has seen.
 */
export function reminderKey(applicationId: string, template: ReminderTemplate, subjectId: string, daysBefore: number, suffix?: string): string {
  return `email:${applicationId}:${template}:${subjectId}:${daysBefore}d${suffix ? `:${suffix}` : ""}`;
}

/** The days-before a reminder's key encodes, or null if it is not a reminder of that kind. */
export function reminderDaysFromKey(key: string, template: ReminderTemplate): number | null {
  const m = new RegExp(`:${template}:[^:]+:(\\d+)d(?::.+)?$`).exec(key);
  if (!m) return null;
  const days = Number(m[1]);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/** One reminder per `daysBefore`, skipping any whose time has as good as come. */
export function reminderJobs(opts: {
  applicationId: string;
  template: ReminderTemplate;
  subjectId: string;
  deadline: Date;
  daysBefore: readonly number[];
  payload: Record<string, Json>;
  precondition: JobPrecondition;
  suffix?: string;
  now?: number;
}): JobSpec[] {
  const now = opts.now ?? Date.now();
  const jobs: JobSpec[] = [];
  for (const days of opts.daysBefore) {
    const at = new Date(opts.deadline.getTime() - days * DAY);
    if (at.getTime() <= now + TOO_SOON_MS) continue;
    jobs.push({
      type: "send_email",
      payload: { template_key: opts.template, ...opts.payload },
      idempotencyKey: reminderKey(opts.applicationId, opts.template, opts.subjectId, days, opts.suffix),
      runAfter: at,
      precondition: opts.precondition,
    });
  }
  return jobs;
}
