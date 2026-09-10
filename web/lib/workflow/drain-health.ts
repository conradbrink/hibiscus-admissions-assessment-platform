/**
 * Whether the scheduled drain is still ticking, in words a person can act on.
 *
 * This exists because for the life of the deployment the Job queue page said
 * the queue drained "every five minutes by cron" while GitHub was delivering
 * one run every three and a half hours, and nothing anywhere contradicted it.
 * A claim about a schedule is worth less than a timestamp from the last time
 * it actually fired.
 *
 * Pure, so the thresholds are testable without a database or a clock.
 */

/** Comfortably more than the five-minute cadence, so one missed tick is not an alarm. */
const HEALTHY_MINUTES = 15;
/** Beyond an hour the hourly backstop should have fired too, so something is properly wrong. */
const WARNING_MINUTES = 60;

export type DrainHealth = {
  tone: "success" | "warning" | "destructive";
  /** A whole sentence, ready to render. */
  phrase: string;
};

function ago(minutes: number): string {
  if (minutes < 1) return "less than a minute ago";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function drainHealth(lastScheduledRun: string | Date | null, now: Date = new Date()): DrainHealth {
  if (!lastScheduledRun) {
    return {
      tone: "destructive",
      phrase:
        "The scheduled drain has never run. Reminders, the weekday sittings and the nightly sweeps are only happening when somebody happens to be using the system.",
    };
  }
  const at = lastScheduledRun instanceof Date ? lastScheduledRun : new Date(lastScheduledRun);
  // A run stamped in the future is a clock disagreeing with itself, not a
  // problem with the queue. Reading it as "just now" beats "in -3 minutes".
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));

  if (minutes < HEALTHY_MINUTES) {
    return { tone: "success", phrase: `The scheduled drain last ran ${ago(minutes)}.` };
  }
  if (minutes < WARNING_MINUTES) {
    return {
      tone: "warning",
      phrase: `The scheduled drain last ran ${ago(minutes)}, which is later than the five minutes it is set to.`,
    };
  }
  return {
    tone: "destructive",
    phrase: `The scheduled drain last ran ${ago(minutes)}. Anything timed — reminders, the weekday sittings, the nightly sweeps — is running late.`,
  };
}
