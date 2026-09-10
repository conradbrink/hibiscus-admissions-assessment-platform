/**
 * The decisions a re-enrolment round makes, away from the database.
 *
 * Pure on purpose: which children are still to answer, when to chase, which
 * grade a returning child goes into, and whether what we hold about them has
 * gone stale are all judgements the school will want to argue with. Arguing
 * with a test is cheaper than arguing with a page.
 */

export type Intent = "returning" | "not_returning" | "undecided";

export type ResponseLike = {
  intent: Intent | null;
  answered_at: string | null;
  reminders_sent: number;
  last_reminder_at: string | null;
  details_confirmed_at: string | null;
};

export type CycleLike = {
  opens_on: string;
  closes_on: string;
  reminder_offsets_days: number[];
  ask_details_refresh: boolean;
};

/**
 * A response is answered when someone said something — including "not sure
 * yet". Undecided is an answer: it means a person spoke to us, and it is a
 * different call from the family who has said nothing at all.
 */
export function isAnswered(r: ResponseLike): boolean {
  return r.answered_at !== null && r.intent !== null;
}

/** Still needs a person: unanswered, or answered "undecided" and gone quiet. */
export function needsFollowUp(r: ResponseLike): boolean {
  return !isAnswered(r) || r.intent === "undecided";
}

/**
 * Whether a reminder is due today.
 *
 * Offsets count back from the closing date, largest first, and each is spent
 * once — `reminders_sent` is the count, so a round that opens inside its own
 * reminder window does not fire them all at once. Nothing is sent after the
 * cycle closes, and nothing to a family who has answered.
 */
export function reminderDue(r: ResponseLike, c: CycleLike, today: string): boolean {
  if (isAnswered(r)) return false;
  if (today > c.closes_on) return false;
  const offsets = [...c.reminder_offsets_days].sort((a, b) => b - a);
  if (r.reminders_sent >= offsets.length) return false;
  // Never twice in one day, however the offsets are configured.
  if (r.last_reminder_at?.slice(0, 10) === today) return false;
  const next = offsets[r.reminders_sent];
  return today >= addDays(c.closes_on, -next);
}

/** ISO day arithmetic, without dragging a date library into a pure module. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export type GradeLike = { id: string; sort_order: number; is_active: boolean };

/**
 * Which class a returning child goes into.
 *
 * Coming back for a later term of the same year is the same class; coming
 * back for a new academic year is the next one up. The next one up is the
 * next active grade by `sort_order` — not "sort_order + 1", because the
 * ladder has gaps and the two Botswana ladders differ from the South African
 * one. Null when they are at the top of what the school offers, which is a
 * child leaving for secondary and a conversation, not a placement.
 */
export function suggestNextGrade(
  grades: readonly GradeLike[],
  currentGradeId: string | null,
  yearRollover: boolean
): string | null {
  if (!currentGradeId) return null;
  const current = grades.find((g) => g.id === currentGradeId);
  if (!current) return null;
  if (!yearRollover) return current.id;
  const higher = grades
    .filter((g) => g.is_active && g.sort_order > current.sort_order)
    .sort((a, b) => a.sort_order - b.sort_order);
  return higher[0]?.id ?? null;
}

/**
 * A cycle rolls the year over when the term it asks about belongs to a later
 * academic year than the one the child is in now.
 */
export function isYearRollover(currentYearStartsOn: string | null, cycleYearStartsOn: string | null): boolean {
  if (!currentYearStartsOn || !cycleYearStartsOn) return false;
  return cycleYearStartsOn > currentYearStartsOn;
}

/** How long before what we hold about a family is worth asking about again. */
export const STALE_DETAILS_DAYS = 180;

export function detailsAreStale(confirmedAt: string | null, today: string, days = STALE_DETAILS_DAYS): boolean {
  if (!confirmedAt) return true;
  return confirmedAt.slice(0, 10) < addDays(today, -days);
}

export type BoardSummary = {
  total: number;
  answered: number;
  returning: number;
  notReturning: number;
  undecided: number;
  unanswered: number;
  detailsConfirmed: number;
  /** What the school actually wants: places it can count on for next term. */
  expected: number;
};

export function summarise(responses: readonly ResponseLike[]): BoardSummary {
  const s: BoardSummary = {
    total: responses.length,
    answered: 0,
    returning: 0,
    notReturning: 0,
    undecided: 0,
    unanswered: 0,
    detailsConfirmed: 0,
    expected: 0,
  };
  for (const r of responses) {
    if (r.details_confirmed_at) s.detailsConfirmed += 1;
    if (!isAnswered(r)) {
      s.unanswered += 1;
      continue;
    }
    s.answered += 1;
    if (r.intent === "returning") s.returning += 1;
    else if (r.intent === "not_returning") s.notReturning += 1;
    else s.undecided += 1;
  }
  // Only the families who said yes. An undecided or a silence is not a place
  // the school can plan around, and counting it as one is how a term starts
  // with classrooms that do not add up.
  s.expected = s.returning;
  return s;
}
