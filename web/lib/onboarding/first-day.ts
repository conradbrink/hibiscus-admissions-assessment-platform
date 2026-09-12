/**
 * The morning list: who is new at a campus today, and what the person opening
 * the gate needs to know before they get there.
 *
 * Pure, because the judgement in it is worth arguing with in a test rather
 * than on a Monday morning — particularly the medical rule below.
 */

export type Starter = {
  id: string;
  firstName: string;
  lastName: string;
  gradeName: string | null;
  /** Anything at all on the child's medical record. */
  hasMedicalNote: boolean;
};

/** When the morning task falls due: the arrival time, or seven if none is set. */
export const DEFAULT_ARRIVAL = "07:00:00";

/**
 * The instant the task is due, in the school's own timezone.
 *
 * Deterministic for a given campus and date — the same value on every sweep of
 * that day — which is what lets a unique index on `(campus_id, due_at)` be the
 * thing that stops a duplicate when two drains overlap.
 */
export function firstDayDueAt(startsOn: string, arrivalTime: string | null): string {
  // Both countries the school is in sit at +02:00 all year — Botswana has no
  // daylight saving and South Africa dropped it in 1944 — so the offset is
  // written out rather than left to the server's clock.
  return new Date(`${startsOn}T${normaliseTime(arrivalTime)}+02:00`).toISOString();
}

/** Postgres hands back `07:00:00` or `07:00`; both have to become the former. */
function normaliseTime(value: string | null): string {
  if (!value || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(value.trim())) return DEFAULT_ARRIVAL;
  const [h, m, s = "00"] = value.trim().split(":");
  return `${h.padStart(2, "0")}:${m}:${s}`;
}

function name(s: Starter): string {
  return `${s.firstName} ${s.lastName}`.trim();
}

/** "Three new starters" — the title, so the list reads at a glance on the board. */
export function firstDayTitle(campusName: string, starters: readonly Starter[]): string {
  const n = starters.length;
  return `${campusName}: ${n === 1 ? "one new starter" : `${n} new starters`} today`;
}

/**
 * The body of the task.
 *
 * The children are named with their grade, because that is what the person at
 * the gate needs. What is deliberately **not** here is the content of anyone's
 * medical record. This task is campus-wide, readable by everyone with
 * `applications.read` on that campus, and it outlives being ticked; copying
 * allergies and medication into it would put a child's medical facts in a
 * second place, with a second lifetime, for the sake of saving one click.
 *
 * So it names *who* has something on record and sends the reader to the child.
 * Nobody is missed, and nothing is duplicated.
 */
export function firstDayDetails(starters: readonly Starter[]): string {
  const lines = starters.map((s) => `· ${name(s)}${s.gradeName ? ` — ${s.gradeName}` : ""}`);
  const flagged = starters.filter((s) => s.hasMedicalNote).map(name);

  const body = [
    "Starting today:",
    lines.join("\n"),
    "",
    "Meet each of them, show them their class, and tick them off on the onboarding board once you have.",
  ];

  if (flagged.length) {
    body.push(
      "",
      flagged.length === 1
        ? `${flagged[0]} has something on their medical record — open their record and read it before the morning.`
        : `These have something on their medical record — open each record and read it before the morning: ${flagged.join(", ")}.`
    );
  }
  return body.join("\n");
}

/** Whether a child's record carries anything a teacher should have read. */
export function hasMedicalNote(student: {
  allergies: string | null;
  medical_conditions: string | null;
  medication: string | null;
  medical_notes: string | null;
}): boolean {
  return [student.allergies, student.medical_conditions, student.medication, student.medical_notes].some(
    (v) => (v ?? "").trim() !== ""
  );
}
