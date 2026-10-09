/**
 * How long an applicant stayed at each job, and what their history says
 * about stability: the average tenure, gaps between jobs, and jobs that
 * overlap.
 *
 * Whole months, counted from the start date to the end date (today for a
 * current job). Dates are ISO `YYYY-MM-DD` strings, compared as calendar
 * dates so a time zone can never move a job across a month boundary.
 *
 * Pure. Unit tested.
 */

export type Job = { id?: string; start_on: string; end_on: string | null; is_school?: boolean };

export type JobTenure = { id?: string; months: number; current: boolean };

export type TenureSummary = {
  jobs: JobTenure[];
  /** Months across every job, overlaps counted once. */
  totalMonths: number;
  /** Months at schools only, overlaps counted once. */
  schoolMonths: number;
  /**
   * The mean over finished jobs. A current job counts only once it has run 12
   * months: a teacher three months into a new post has not left it early.
   * Null when nothing qualifies.
   */
  averageMonths: number | null;
  /** Gaps of more than six months between one job ending and the next starting. */
  gaps: Array<{ fromOn: string; toOn: string; months: number }>;
  /** Pairs of jobs that ran at the same time for more than a month. */
  overlaps: Array<{ a: number; b: number; months: number }>;
};

type Ymd = { y: number; m: number; d: number };

function parse(iso: string): Ymd {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** Whole months from a to b; zero or more. 15 Jan to 14 Feb is 0, to 15 Feb is 1. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = parse(fromIso);
  const b = parse(toIso);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Merges [start, end] intervals and returns the months they cover, counted once. */
function coveredMonths(intervals: Array<[string, string]>): number {
  const sorted = intervals.filter(([s, e]) => e >= s).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  let total = 0;
  let cur: [string, string] | null = null;
  for (const [s, e] of sorted) {
    if (!cur) cur = [s, e];
    else if (s <= cur[1]) cur[1] = e > cur[1] ? e : cur[1];
    else {
      total += monthsBetween(cur[0], cur[1]);
      cur = [s, e];
    }
  }
  if (cur) total += monthsBetween(cur[0], cur[1]);
  return total;
}

export function summariseTenure(jobs: readonly Job[], today: Date = new Date()): TenureSummary {
  const todayIso = iso(today);
  const tenures: JobTenure[] = jobs.map((j) => ({
    id: j.id,
    months: monthsBetween(j.start_on, j.end_on ?? todayIso),
    current: j.end_on === null,
  }));

  const counted = tenures.filter((t) => !t.current || t.months >= 12);
  const averageMonths = counted.length
    ? Math.round(counted.reduce((sum, t) => sum + t.months, 0) / counted.length)
    : null;

  const intervals = jobs.map((j): [string, string] => [j.start_on, j.end_on ?? todayIso]);
  const totalMonths = coveredMonths(intervals);
  const schoolMonths = coveredMonths(jobs.filter((j) => j.is_school !== false).map((j): [string, string] => [j.start_on, j.end_on ?? todayIso]));

  // Gaps: walk the merged timeline in order.
  const gaps: TenureSummary["gaps"] = [];
  const sorted = [...intervals].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  let reach: string | null = null;
  for (const [s, e] of sorted) {
    if (reach && s > reach) {
      const months = monthsBetween(reach, s);
      if (months > 6) gaps.push({ fromOn: reach, toOn: s, months });
    }
    if (!reach || e > reach) reach = e;
  }

  const overlaps: TenureSummary["overlaps"] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let k = i + 1; k < intervals.length; k++) {
      const start = intervals[i][0] > intervals[k][0] ? intervals[i][0] : intervals[k][0];
      const end = intervals[i][1] < intervals[k][1] ? intervals[i][1] : intervals[k][1];
      if (end > start) {
        const months = monthsBetween(start, end);
        if (months > 1) overlaps.push({ a: i, b: k, months });
      }
    }
  }

  return { jobs: tenures, totalMonths, schoolMonths, averageMonths, gaps, overlaps };
}

/** "3 years 4 months", "8 months", "less than a month". */
export function formatMonths(months: number): string {
  if (months <= 0) return "less than a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years ? `${years} year${years === 1 ? "" : "s"}` : "";
  const m = rest ? `${rest} month${rest === 1 ? "" : "s"}` : "";
  return [y, m].filter(Boolean).join(" ");
}
