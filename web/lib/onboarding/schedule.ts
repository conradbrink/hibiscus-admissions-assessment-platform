/**
 * When each onboarding message is due, away from the database.
 *
 * Pure on purpose. "Three weeks before, then ten days, then three days, then
 * five days after" is exactly the sort of thing the school will want to move,
 * and moving it should mean arguing with a test rather than with a parent who
 * got two messages in an hour.
 */

export type JourneyStep = "welcome" | "outstanding" | "first_day" | "first_week";

/**
 * Days relative to the child's first day. Negative is before.
 *
 * Three before and one after, which is what the school asked for: a family who
 * does everything promptly hears from us three times, because `outstanding` is
 * skipped when their checklist is clear.
 */
export const JOURNEY: ReadonlyArray<{ step: JourneyStep; offsetDays: number }> = [
  { step: "welcome", offsetDays: -21 },
  { step: "outstanding", offsetDays: -10 },
  { step: "first_day", offsetDays: -3 },
  { step: "first_week", offsetDays: 5 },
];

/** ISO day arithmetic, without dragging a date library into a pure module. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The day each step becomes due, for one child's start date. */
export function dueOn(startsOn: string, step: JourneyStep): string {
  const entry = JOURNEY.find((j) => j.step === step);
  if (!entry) throw new Error(`unknown journey step: ${step}`);
  return addDays(startsOn, entry.offsetDays);
}

/**
 * The one step to send today, or null.
 *
 * **One at a time, earliest first.** A family enrolling a week before term
 * starts is already past three of the four offsets, and firing all three at
 * once is precisely the wall of messages the school asked to avoid. They get
 * the welcome today, the outstanding list tomorrow, the first-day details the
 * day after — each still in the right order, each still worth reading.
 *
 * The caller is what stops `outstanding` going to a family with nothing
 * outstanding; this only says whose turn it is.
 */
export function nextStep(startsOn: string, today: string, sent: readonly JourneyStep[]): JourneyStep | null {
  const done = new Set(sent);
  for (const { step } of JOURNEY) {
    if (done.has(step)) continue;
    if (today >= dueOn(startsOn, step)) return step;
    // Nothing later can be due if this one is not: the offsets ascend.
    return null;
  }
  return null;
}

/**
 * Whether a step still makes sense to send at all.
 *
 * A welcome that arrives after the child has started is worse than no welcome
 * — it tells a family the school is not paying attention. The two messages
 * that only make sense beforehand expire on the first day; the check-in only
 * makes sense afterwards and is handled by its own positive offset.
 */
export function stillWorthSending(step: JourneyStep, startsOn: string, today: string): boolean {
  if (step === "welcome" || step === "outstanding") return today < startsOn;
  if (step === "first_day") return today <= startsOn;
  return true;
}
