import "server-only";
import { toSchoolDateString } from "@/lib/format-date";
import { firstDayDetails, firstDayDueAt, firstDayTitle, hasMedicalNote, type Starter } from "@/lib/onboarding/first-day";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * The morning of the first day, swept once per drain.
 *
 * One task per campus listing everyone starting there today, and a checklist
 * item per child so that greeting them is recorded rather than assumed.
 *
 * Deliberately **not** gated on `onboarding_journey_enabled`. That switch
 * governs what the school sends families; this sends nobody anything. A school
 * still deciding whether to automate its messages should still get the list on
 * the morning.
 *
 * The task is left unassigned on purpose. Every other task the journey creates
 * goes to the person who owned the application, because it is about one child
 * and one family. This one is about a campus, so it belongs on that campus's
 * shared list where whoever opens the gate can pick it up — a morning job
 * addressed to someone who happens to be on leave is worse than one addressed
 * to nobody.
 */

export type FirstDaySweep = { campuses: number; starters: number };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function sweepFirstDay(admin: AdminClient, now: Date = new Date()): Promise<FirstDaySweep> {
  const sweep: FirstDaySweep = { campuses: 0, starters: 0 };
  const today = toSchoolDateString(now);

  const { data: enrolments, error } = await admin
    .from("enrolments")
    .select(
      "student_id, starts_on, campus_id, students!inner(id, legal_first_name, legal_last_name, preferred_name, status, allergies, medical_conditions, medication, medical_notes), campuses(name, first_day_arrival_time), grades(name)"
    )
    .eq("starts_on", today)
    .in("students.status", ["onboarding", "active"]);
  if (error) throw new Error(error.message);
  if (!enrolments?.length) return sweep;

  const byCampus = new Map<string, { campusName: string; arrival: string | null; starters: Starter[] }>();

  for (const e of enrolments) {
    const student = one(e.students);
    if (!student || !e.campus_id) continue;

    // Idempotent, and how a step added after a child enrolled reaches them:
    // `open_student_onboarding` inserts only what is missing and touches no
    // answer. Without this, `welcomed_on_first_day` would exist for children
    // who enrol from today and for nobody already on their way in.
    await admin.rpc("open_student_onboarding", { p_student_id: e.student_id });

    const campus = one(e.campuses);
    const group = byCampus.get(e.campus_id) ?? {
      campusName: campus?.name ?? "The campus",
      arrival: campus?.first_day_arrival_time ?? null,
      starters: [],
    };
    group.starters.push({
      id: student.id,
      firstName: student.preferred_name || student.legal_first_name,
      lastName: student.legal_last_name,
      gradeName: one(e.grades)?.name ?? null,
      hasMedicalNote: hasMedicalNote(student),
    });
    byCampus.set(e.campus_id, group);
    sweep.starters += 1;
  }

  for (const [campusId, group] of byCampus) {
    const dueAt = firstDayDueAt(today, group.arrival);
    // `tasks_one_first_day_welcome_idx` is what makes this safe when two
    // drains overlap: the second insert collides rather than opening a second
    // list. A collision is the expected outcome on every sweep after the
    // first, so it is not an error.
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        campus_id: campusId,
        type: "welcome_new_starters",
        title: firstDayTitle(group.campusName, group.starters),
        details: firstDayDetails(group.starters),
        due_at: dueAt,
        priority: "high",
      })
      .select("id")
      .maybeSingle();
    if (taskError && taskError.code !== "23505") throw new Error(taskError.message);
    if (task) sweep.campuses += 1;
  }

  return sweep;
}
