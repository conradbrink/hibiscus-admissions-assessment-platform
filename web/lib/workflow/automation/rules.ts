import type { Settings } from "@/lib/settings";
import type { ApplicationStatus } from "@/lib/supabase/types";

/**
 * The pure rules the automations follow — which rows retention picks, in
 * what order the waitlist is served, how a digest is keyed. No imports of
 * server modules, so the rules are unit tested on their own.
 */

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const ABANDONED_STATUSES: ApplicationStatus[] = ["new_enquiry", "callback_requested", "no_show"];
export const CLOSED_STATUSES: ApplicationStatus[] = ["declined", "withdrawn", "offer_declined", "offer_expired"];

export type RetentionRow = {
  id: string;
  status: ApplicationStatus;
  status_changed_at: string;
  retention_hold: boolean;
  anonymised_at: string | null;
};

/** Which rows are due: the rule in one place for the preview and the run. */
export function retentionCandidates<T extends RetentionRow>(rows: T[], settings: Pick<Settings, "retentionDaysAbandoned" | "retentionDaysClosed">, now: Date): T[] {
  const cutoff = (days: number) => now.getTime() - days * 86_400_000;
  return rows.filter((r) => {
    if (r.anonymised_at || r.retention_hold) return false;
    const changed = new Date(r.status_changed_at).getTime();
    if (ABANDONED_STATUSES.includes(r.status)) return changed < cutoff(settings.retentionDaysAbandoned);
    if (CLOSED_STATUSES.includes(r.status)) return changed < cutoff(settings.retentionDaysClosed);
    return false;
  });
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

/** Waitlisted applications in the order they should be offered places: longest waiting first. */
export function waitlistOrder<T extends { status_changed_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.status_changed_at.localeCompare(b.status_changed_at));
}

/** Groups waitlisted applications by the capacity they compete for: campus, grade, academic year. */
export function groupByPlace<T extends { campus_id: string; grade_id: string; intake_id: string }>(rows: T[], academicYearOf: (intakeId: string) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.campus_id}:${r.grade_id}:${academicYearOf(r.intake_id) ?? r.intake_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

/** The Gaborone calendar date and hour, which is what "morning" means here. */
export function gaboroneNow(now = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Gaborone", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export function digestKey(campusId: string, date: string): string {
  return `digest:${campusId}:${date}`;
}

/** Whether the digest has anything to say. */
export function digestHasContent(counts: Record<string, number>): boolean {
  return Object.values(counts).some((v) => v > 0);
}
