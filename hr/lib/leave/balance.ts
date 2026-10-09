/**
 * Leave balances, worked out rather than stored: what someone is entitled to
 * this year, minus what has been approved. Pure and unit tested.
 *
 * The leave year is the calendar year. Someone who starts (or leaves) part of
 * the way through a year gets the share of the year they work, rounded to
 * the nearest half day. A type with no yearly allowance (maternity, unpaid)
 * has no balance, only days taken.
 */

export type LeaveTypeLite = { code: string; name: string; days_per_year: number; country: "BW" | "ZA" | null; is_active: boolean };
export type LeaveRequestLite = { leave_type_code: string; starts_on: string; days: number; status: string };

export type Balance = {
  code: string;
  name: string;
  /** Null: no yearly allowance. */
  entitledDays: number | null;
  takenDays: number;
  pendingDays: number;
  remainingDays: number | null;
};

const halfDay = (n: number) => Math.round(n * 2) / 2;

/** Months of the year worked, counting a month started or left in as worked. */
export function monthsEmployedIn(year: number, startDate: string, endDate: string | null): number {
  const [sy, sm] = startDate.split("-").map(Number);
  const first = sy < year ? 1 : sy === year ? sm : 13;
  let last = 12;
  if (endDate) {
    const [ey, em] = endDate.split("-").map(Number);
    last = ey > year ? 12 : ey === year ? em : 0;
  }
  return Math.max(0, last - first + 1);
}

export function entitlementFor(
  type: Pick<LeaveTypeLite, "days_per_year">,
  year: number,
  employee: { start_date: string; end_date: string | null },
  override: number | null
): number | null {
  if (override !== null) return override;
  if (!type.days_per_year) return null;
  return halfDay((type.days_per_year * monthsEmployedIn(year, employee.start_date, employee.end_date)) / 12);
}

/** The leave types that apply in a country, in their order. */
export function typesFor(types: readonly LeaveTypeLite[], country: "BW" | "ZA"): LeaveTypeLite[] {
  return types.filter((t) => t.is_active && (!t.country || t.country === country));
}

export function balancesFor(input: {
  year: number;
  country: "BW" | "ZA";
  employee: { start_date: string; end_date: string | null };
  types: readonly LeaveTypeLite[];
  requests: readonly LeaveRequestLite[];
  overrides: Readonly<Record<string, number>>;
}): Balance[] {
  const inYear = input.requests.filter((r) => Number(r.starts_on.slice(0, 4)) === input.year);
  return typesFor(input.types, input.country).map((t) => {
    const mine = inYear.filter((r) => r.leave_type_code === t.code);
    const taken = mine.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.days), 0);
    const pending = mine.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.days), 0);
    const entitled = entitlementFor(t, input.year, input.employee, input.overrides[t.code] ?? null);
    return {
      code: t.code,
      name: t.name,
      entitledDays: entitled,
      takenDays: taken,
      pendingDays: pending,
      remainingDays: entitled === null ? null : entitled - taken,
    };
  });
}

/** Two requests overlap if they share a day. Declined and cancelled ones do not count. */
export function overlaps(a: { starts_on: string; ends_on: string }, b: { starts_on: string; ends_on: string; status: string }): boolean {
  if (b.status === "declined" || b.status === "cancelled") return false;
  return a.starts_on <= b.ends_on && b.starts_on <= a.ends_on;
}
