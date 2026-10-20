import type { TransportPeriodRow } from "@/lib/supabase/types";

/**
 * Which bookings belong to a period on the staff screens.
 *
 * A parent books a whole term or one month of it, so a child riding in
 * January may be on a booking for the term or for January itself. The rider
 * list for a period therefore takes both: a term with its months, a month
 * with its term. The money is different: a term's earnings are the term's own
 * bookings and its months', and a month's are its own.
 *
 * Pure, so the rules are tested rather than read off a query.
 */

export type PeriodLike = Pick<TransportPeriodRow, "id" | "kind" | "term_period_id" | "month_index" | "label" | "starts_on" | "ends_on">;

/** Who rides during `chosenId`: its own bookings, and those for its term or its months. */
export function ridingPeriodIds(periods: readonly PeriodLike[], chosenId: string): string[] {
  const chosen = periods.find((p) => p.id === chosenId);
  if (!chosen) return [];
  if (chosen.kind === "term") return [chosen.id, ...periods.filter((p) => p.term_period_id === chosen.id).map((p) => p.id)];
  return chosen.term_period_id ? [chosen.id, chosen.term_period_id] : [chosen.id];
}

/** A term and its months: what the term's earnings and payouts cover. */
export function termPeriodIds(periods: readonly PeriodLike[], termId: string): string[] {
  const term = periods.find((p) => p.id === termId && p.kind === "term");
  if (!term) return [];
  return [term.id, ...periods.filter((p) => p.term_period_id === term.id).map((p) => p.id)];
}

/** The term running today, else the next to start, else the most recent. */
export function defaultTerm<P extends PeriodLike>(periods: readonly P[], today: string): P | null {
  const terms = periods.filter((p) => p.kind === "term").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return (
    terms.find((t) => t.starts_on <= today && today <= t.ends_on) ??
    terms.find((t) => t.starts_on > today) ??
    terms.at(-1) ??
    null
  );
}

/** Terms first, each followed by its months, for a period picker. */
export function periodOptions<P extends PeriodLike>(periods: readonly P[]): Array<P & { indent: boolean }> {
  const terms = periods.filter((p) => p.kind === "term").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return terms.flatMap((t) => [
    { ...t, indent: false },
    ...periods
      .filter((m) => m.term_period_id === t.id)
      .sort((a, b) => (a.month_index ?? 0) - (b.month_index ?? 0))
      .map((m) => ({ ...m, indent: true })),
  ]);
}

/** A stretch of time whose riders share the same seats: a month, or a period with no months. */
export type SeatWindow = { id: string; label: string; periodIds: string[] };

/**
 * What the seat counts are taken over. Children booked for different months
 * of a term never ride on the same day, so a term's seats are counted month
 * by month, each month with the children booked for the whole term. A term
 * with no months, or a single month, is one window.
 */
export function seatWindows(periods: readonly PeriodLike[], chosenId: string): SeatWindow[] {
  const chosen = periods.find((p) => p.id === chosenId);
  if (!chosen) return [];
  if (chosen.kind === "month") {
    return [{ id: chosen.id, label: chosen.label, periodIds: chosen.term_period_id ? [chosen.id, chosen.term_period_id] : [chosen.id] }];
  }
  const months = periods.filter((p) => p.term_period_id === chosen.id).sort((a, b) => (a.month_index ?? 0) - (b.month_index ?? 0));
  if (!months.length) return [{ id: chosen.id, label: chosen.label, periodIds: [chosen.id] }];
  return months.map((m) => ({ id: m.id, label: m.label, periodIds: [chosen.id, m.id] }));
}
