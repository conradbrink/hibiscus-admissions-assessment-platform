/**
 * Which terms a parent may still choose.
 *
 * The catalogue used to ask for intakes whose `starts_on` had not yet
 * arrived, which quietly removed the term the school is actually teaching.
 * Term 3 2026 began on 7 September; on 10 September a parent enquiring for
 * it was offered January 2027 as the earliest date. Children join mid-term
 * all the time — a family moves to Gaborone in week two — so the running
 * term has to stay on the list.
 *
 * The rule now:
 *
 *   - `is_open` is the school's own switch and comes first. A term nobody
 *     has opened is never offered, whatever its dates.
 *   - Every open term still to start is offered.
 *   - Plus the one running now: the most recent term that has already begun,
 *     while its academic year is still going.
 *
 * The last clause is what keeps it honest at both ends. An earlier term of
 * the same year has been overtaken and is not offered — you cannot join
 * Term 1 in September — and once the year has ended, its final term stops
 * being offered too, so nothing is left dangling over the December break.
 */

export type IntakeChoice = {
  starts_on: string;
  is_open: boolean;
  /** The last day of the academic year this term belongs to. */
  year_ends_on: string | null;
};

/** Dates are ISO days (`2026-09-07`), which compare correctly as strings. */
export function offerableIntakes<T extends IntakeChoice>(rows: readonly T[], today: string): T[] {
  const open = rows.filter((r) => r.is_open).sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  const ahead = open.filter((r) => r.starts_on >= today);

  // The running term: the last one that has begun, if its year has not ended.
  // A null year end means we cannot tell, and a term we cannot date the end
  // of is not offered after it has started — the school can reopen the next
  // one instead of us guessing.
  const started = open.filter((r) => r.starts_on < today);
  const current = started.at(-1);
  const running = current && current.year_ends_on !== null && current.year_ends_on >= today ? [current] : [];

  return [...running, ...ahead];
}
