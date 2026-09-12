/**
 * Why a family stopped applying.
 *
 * The note in somebody's own words stays — it is often the useful part. The
 * code beside it is what can be counted: free text cannot be grouped, and a
 * school that cannot see "fees: 40% of the families we lose" cannot act on it.
 *
 * Six options, deliberately few. A list long enough to describe every case is
 * a list nobody fills in accurately, and "other" plus the note carries the
 * rest. They are the answers the admissions office actually hears.
 */

export const WITHDRAWN_REASON_CODES = [
  "another_school",
  "fees",
  "moving_away",
  "changed_mind",
  "no_longer_needed",
  "other",
] as const;

export type WithdrawnReasonCode = (typeof WITHDRAWN_REASON_CODES)[number];

export const WITHDRAWN_REASON_LABELS: Record<WithdrawnReasonCode, string> = {
  another_school: "Chose another school",
  fees: "Fees",
  moving_away: "Moving away",
  changed_mind: "Changed their mind",
  no_longer_needed: "No longer needed",
  other: "Other",
};

export function isWithdrawnReasonCode(v: string | null | undefined): v is WithdrawnReasonCode {
  return (WITHDRAWN_REASON_CODES as readonly string[]).includes(v ?? "");
}

/**
 * What the analytics calls a withdrawal with no code: everything withdrawn
 * before the list existed, and every withdrawal the system made on its own
 * behalf. Named rather than dropped, so the share that is unknown is visible
 * instead of quietly shrinking the denominator.
 */
export const WITHDRAWN_REASON_UNKNOWN = "not recorded";
