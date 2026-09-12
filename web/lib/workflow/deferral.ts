/**
 * When to follow up a family who asked to be contacted later in the year.
 *
 * Pure, because the rhythm is the part the school will want to move and
 * because "message them around the date" has three ways to go wrong that a
 * test can hold still: firing a follow-up for a date already past, firing the
 * same one twice because the drain ran twice, and chasing a family who has
 * already answered.
 *
 * The last of those is not decided here. Both sends carry
 * `precondition: { application_status: ["deferred"] }`, the mechanism
 * `enquiry_nudge` already uses, so a family who replies — or whom staff move
 * back — is never chased. This only says whose turn it is and when.
 */

export const DEFERRAL_TEMPLATE_KEY = "deferred_follow_up";

/**
 * Every campus is UTC+2 the year round — Gaborone and Johannesburg alike, no
 * daylight saving — so the offset is written out rather than carried through
 * a timezone database for one hour a day.
 */
const SEND_AT = "T09:00:00+02:00";

/** How close to now is too close to be worth queuing, so a date already here does not fire twice. */
const MIN_LEAD_MS = 15 * 60_000;

export type DeferralFollowUp = {
  /** When the job runs. */
  runAt: Date;
  /** Days before `deferred_until`. Zero is the morning of the date itself. */
  daysBefore: number;
  /**
   * Part of the idempotency key, so the same follow-up queued twice is one
   * job. The date is in it too: a family who moves their date gets a fresh
   * pair rather than the old pair silently kept.
   */
  suffix: string;
};

function atSendTime(day: string, minusDays: number): Date {
  const d = new Date(`${day}${SEND_AT}`);
  d.setUTCDate(d.getUTCDate() - minusDays);
  return d;
}

/**
 * The follow-ups worth queuing for one deferral.
 *
 * `daysBefore` is the setting: one entry per message, largest first, so the
 * default `[5, 0]` is "five days before, then on the morning of the date".
 * A single entry is a single message; an empty list is none, which is a
 * school that would rather do this by hand.
 *
 * An offset already in the past is dropped rather than fired late: a family
 * who names a date next week should not get "we said we would call around
 * now" five days after the fact.
 */
export function deferralFollowUps(
  deferredUntil: string,
  daysBefore: readonly number[],
  now: Date = new Date()
): DeferralFollowUp[] {
  const offsets = [...new Set(daysBefore.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a);
  const floor = now.getTime() + MIN_LEAD_MS;
  return offsets
    .map((daysBefore) => ({ runAt: atSendTime(deferredUntil, daysBefore), daysBefore, suffix: `${deferredUntil}:${daysBefore}d` }))
    .filter((f) => f.runAt.getTime() > floor);
}

/**
 * When to put "ring them" on the owner's badge: the date itself, at the same
 * hour. A message is easy to ignore from both ends; the point of the deferral
 * is that a person picks it up if the messages do not land.
 */
export function deferralTaskDueAt(deferredUntil: string): Date {
  return atSendTime(deferredUntil, 0);
}

/**
 * Where a family lands when the deferral ends.
 *
 * Not always where they came from. Deferring cancels any live booking — the
 * seat goes back and the reminders stop — so a family who paused with an
 * assessment booked has nothing booked when they return, and putting them back
 * in `awaiting_decision` would leave them waiting on a school decision that
 * cannot be made until a child who has not sat the assessment sits it. They go
 * to `new_enquiry`, where the next step is to book.
 *
 * A family who has already sat it, or never needed to, goes to
 * `awaiting_decision`, which is where their answer actually comes from.
 */
export function statusAfterDeferral(input: {
  requiresAssessment: boolean;
  /** A sitting that was submitted or marked. A cancelled booking is not one. */
  hasSatAssessment: boolean;
}): "new_enquiry" | "awaiting_decision" {
  return input.requiresAssessment && !input.hasSatAssessment ? "new_enquiry" : "awaiting_decision";
}

/** Is this date worth deferring to at all? Past dates are a typo, not a plan. */
export function isFutureDate(day: string, now: Date = new Date()): boolean {
  return atSendTime(day, 0).getTime() > now.getTime();
}
