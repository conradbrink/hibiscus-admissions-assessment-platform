import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { formatDateLong, formatTime, toSchoolDateString } from "@/lib/format-date";
import { ownerForStudent } from "@/lib/onboarding/owner";
import { outstandingRequired, type ItemLike, type StepLike } from "@/lib/onboarding/progress";
import { nextStep, stillWorthSending, type JourneyStep } from "@/lib/onboarding/schedule";
import { getSettings } from "@/lib/settings";
import { enqueueJobs } from "@/lib/workflow/engine";

/**
 * The onboarding journey, swept once per drain.
 *
 * Three messages before a child starts and one after, anchored on the
 * enrolment's start date. Gated by `onboarding_journey_enabled`, which ships
 * off: the school should watch one family go through by hand before the
 * product starts writing to everyone who enrols.
 *
 * At most one message per child per sweep, by construction — `nextStep`
 * returns one step or none. A family enrolling a week before term gets the
 * welcome today and the rest on the following days, in order, rather than
 * three messages in one afternoon.
 */

export type OnboardingSweep = { sent: number; skipped: number; tasks: number };

const TEMPLATE: Record<JourneyStep, string> = {
  welcome: "onboarding_welcome",
  outstanding: "onboarding_outstanding",
  first_day: "first_day_details",
  first_week: "first_week_check_in",
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function sweepOnboarding(admin: AdminClient, now: Date = new Date()): Promise<OnboardingSweep> {
  const sweep: OnboardingSweep = { sent: 0, skipped: 0, tasks: 0 };
  const settings = await getSettings(admin);
  if (!settings.onboardingJourneyEnabled) return sweep;

  const today = toSchoolDateString(now);

  // Children who are on their way in. `active` is included because the
  // first-week check-in falls after the start date, by which point the
  // enrolment trigger has already moved them on.
  const { data: enrolments, error } = await admin
    .from("enrolments")
    .select(
      "id, student_id, starts_on, campus_id, students!inner(id, legal_first_name, preferred_name, family_id, status), campuses(name, address, phone, first_day_arrival_time), grades(name)"
    )
    .not("starts_on", "is", null)
    .in("students.status", ["onboarding", "active"]);
  if (error) throw new Error(error.message);

  const { data: steps } = await admin.from("onboarding_steps").select("*");

  for (const e of enrolments ?? []) {
    const student = one(e.students);
    if (!student?.family_id || !e.starts_on) continue;

    const { data: sentRows } = await admin
      .from("student_journey_messages")
      .select("step")
      .eq("student_id", e.student_id);
    const sent = (sentRows ?? []).map((r) => r.step as JourneyStep);

    const step = nextStep(e.starts_on, today, sent);
    if (!step) continue;

    // A welcome that lands after the child has started tells a family the
    // school is not paying attention. Record it as spent rather than sending
    // it late, so the journey moves on to the step that still makes sense.
    if (!stillWorthSending(step, e.starts_on, today)) {
      await admin.from("student_journey_messages").insert({ student_id: e.student_id, step }).select("id").maybeSingle();
      sweep.skipped += 1;
      continue;
    }

    const campus = one(e.campuses);
    const firstName = student.preferred_name || student.legal_first_name;
    const variables: Record<string, string | null> = {
      student_first_name: firstName,
      campus: campus?.name ?? "Hibiscus",
      grade: one(e.grades)?.name ?? "",
      start_date: formatDateLong(e.starts_on),
      campus_phone: campus?.phone ?? null,
      campus_address: campus?.address ?? null,
      arrival_time: campus?.first_day_arrival_time ? formatTime(`1970-01-01T${campus.first_day_arrival_time}Z`) : null,
      guide_url: settings.parentGuideUrl || null,
    };

    if (step === "outstanding") {
      const { data: items } = await admin
        .from("student_onboarding_items")
        .select("step_code, status, due_on")
        .eq("student_id", e.student_id);
      const owing = outstandingRequired((steps ?? []) as StepLike[], (items ?? []) as ItemLike[]);
      // Nothing outstanding is the good case, and the reason a family who is
      // on top of things hears from us three times rather than four.
      if (!owing.length) {
        await admin.from("student_journey_messages").insert({ student_id: e.student_id, step }).select("id").maybeSingle();
        sweep.skipped += 1;
        continue;
      }
      const labels = new Map((steps ?? []).map((s) => [s.code, s.label]));
      variables.outstanding_items = owing.map((i) => `· ${labels.get(i.step_code) ?? i.step_code}`).join("\n");
    }

    await enqueueJobs(admin, [
      {
        type: "send_email",
        applicationId: null,
        // The step is in the key, so a redelivered sweep cannot send twice
        // even before the row below lands.
        idempotencyKey: `onboarding:${e.student_id}:${step}`,
        payload: {
          template_key: TEMPLATE[step],
          family_id: student.family_id,
          student_id: e.student_id,
          family_link: step === "first_week" ? null : "onboarding",
          variables,
        },
      },
    ]);
    // Stamped whether or not the send succeeds: the job carries its own
    // idempotency and its own retries, and stamping only on success would
    // send again on the next sweep.
    await admin.from("student_journey_messages").insert({ student_id: e.student_id, step }).select("id").maybeSingle();
    sweep.sent += 1;

    // The first-day message invites a reply, so somebody has to be expecting
    // one. Opened once, with the message, rather than on a schedule of its own.
    if (step === "first_day") {
      const assignee = await ownerForStudent(admin, e.student_id);
      const { data: task } = await admin
        .from("tasks")
        .insert({
          student_id: e.student_id,
          campus_id: e.campus_id,
          type: "onboarding_first_day",
          title: `${firstName} starts on ${formatDateLong(e.starts_on)}`,
          details:
            "The family has been sent the first-day details and invited to reply if they need anything. " +
            "Check their checklist is clear and that the campus is expecting them.",
          assignee_staff_id: assignee,
          due_at: new Date(`${e.starts_on}T00:00:00Z`).toISOString(),
          priority: "normal",
        })
        .select("id")
        .maybeSingle();
      if (task) sweep.tasks += 1;
    }
  }

  return sweep;
}
