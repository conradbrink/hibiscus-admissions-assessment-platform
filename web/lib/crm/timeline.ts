/**
 * The relationship timeline: everything that happened between a family and
 * the school, from every log that holds a piece of it, in one order.
 *
 * Each source becomes an entry with a kind, a time, a line and a link. The
 * merge is pure; `families.ts` reads the sources.
 */

export type TimelineKind =
  | "admissions"
  | "enrolment"
  | "email"
  | "whatsapp"
  | "task"
  | "note"
  | "opportunity"
  | "event"
  | "campaign"
  | "lifecycle"
  | "onboarding"
  | "reenrolment"
  | "audit";

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string | null;
  href?: string | null;
  /** A person, or "System", or "Parent". */
  actor?: string | null;
  /** For a message: sent, delivered, read, failed… */
  status?: string | null;
};

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  admissions: "Admissions",
  enrolment: "Enrolment",
  email: "Email",
  whatsapp: "WhatsApp",
  task: "Task",
  note: "Note",
  opportunity: "Opportunity",
  event: "Event",
  campaign: "Campaign",
  lifecycle: "Lifecycle",
  onboarding: "Onboarding",
  reenrolment: "Re-enrolment",
  audit: "Change",
};

/** Newest first, with a stable tiebreak so two entries at one instant do not swap between renders. */
export function mergeTimeline(...sources: ReadonlyArray<ReadonlyArray<TimelineEntry>>): TimelineEntry[] {
  const all = sources.flat();
  return all.sort((a, b) => {
    const t = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The first N, plus how many were left off. */
export function takeTimeline(entries: readonly TimelineEntry[], limit: number): { shown: TimelineEntry[]; more: number } {
  return { shown: entries.slice(0, limit), more: Math.max(0, entries.length - limit) };
}

/** Entries grouped by the day they happened, in the school's zone, for the profile. */
export function groupByDay(entries: readonly TimelineEntry[], dayOf: (iso: string) => string): Array<{ day: string; entries: TimelineEntry[] }> {
  const groups: Array<{ day: string; entries: TimelineEntry[] }> = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}
