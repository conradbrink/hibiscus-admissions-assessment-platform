import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import type { RegistrationBundle } from "@/lib/registration/load";

/**
 * The moment the funnel hands the child over.
 *
 * `student_records.snapshot` is what the school's other system was told at
 * enrolment, frozen for good. This is the other half: the child as a row that
 * goes on existing — through next term, the term after, and a sibling's
 * enquiry two years from now.
 *
 * Everything is keyed on `origin_application_id`, so confirming an enrolment
 * twice produces the same student rather than a second child. The registration
 * is read with the same fallbacks `buildStudentRecord` uses, so the record and
 * the register never disagree about a name.
 */

export type PromotionResult = { studentId: string; enrolmentId: string; created: boolean };

export async function promoteToStudent(
  admin: AdminClient,
  graph: ApplicationGraph,
  bundle: RegistrationBundle
): Promise<PromotionResult> {
  const app = graph.application;

  // The trigger on `contacts` mints a family with the code, so this is set for
  // every contact. A row from before that trigger existed would have been
  // filled in by the same migration's backfill.
  const familyId = graph.contact.family_id;
  if (!familyId) {
    throw new Error(`Contact ${graph.contact.id} has no family; cannot enrol ${app.reference}.`);
  }

  const existing = await admin
    .from("students")
    .select("id")
    .eq("origin_application_id", app.id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const r = bundle.registration;
  const details = {
    family_id: familyId,
    legal_first_name: r?.legal_first_name ?? app.child_first_name,
    legal_middle_names: r?.legal_middle_names ?? null,
    legal_last_name: r?.legal_last_name ?? app.child_last_name,
    preferred_name: r?.preferred_name ?? app.child_preferred_name ?? null,
    gender: r?.gender ?? null,
    date_of_birth: r?.date_of_birth ?? app.child_date_of_birth,
    nationality: r?.nationality ?? null,
    country_of_birth: r?.country_of_birth ?? null,
    place_of_birth: r?.place_of_birth ?? null,
    home_language: r?.home_language ?? null,
    identity_type: r?.identity_type ?? null,
    identity_number: r?.identity_number ?? null,
    medical_aid_name: r?.medical_aid_name ?? null,
    medical_aid_number: r?.medical_aid_number ?? null,
    medical_aid_principal_member: r?.medical_aid_principal_member ?? null,
    emergency_treatment_consent: r?.emergency_treatment_consent ?? null,
    allergies: r?.allergies ?? null,
    medical_conditions: r?.medical_conditions ?? null,
    medication: r?.medication ?? null,
    medical_notes: r?.medical_notes ?? null,
    vaccination_notes: r?.vaccination_notes ?? null,
    current_campus_id: app.campus_id,
    current_grade_id: app.grade_id,
    // The parent filled this in minutes ago, so it is confirmed today. The
    // termly refresh is what moves it on from here.
    details_confirmed_at: new Date().toISOString(),
  };

  let studentId: string;
  if (existing.data) {
    studentId = existing.data.id;
    const { error } = await admin.from("students").update(details).eq("id", studentId);
    if (error) throw new Error(error.message);
  } else {
    // The code is minted by the database, which holds the counter.
    const code = await admin.rpc("next_student_code");
    if (code.error) throw new Error(code.error.message);
    const { data, error } = await admin
      .from("students")
      .insert({ ...details, student_code: code.data, origin_application_id: app.id })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "student insert failed");
    studentId = data.id;
  }

  // One enrolment per academic year. The child starts on the intake's own
  // date; `pending` until that day, and the trigger on the table moves the
  // student to `active` once it has passed.
  const { data: enrolment, error: eErr } = await admin
    .from("enrolments")
    .upsert(
      {
        student_id: studentId,
        academic_year_id: graph.intake.academic_year_id,
        intake_id: graph.intake.id,
        campus_id: app.campus_id,
        grade_id: app.grade_id,
        origin_application_id: app.id,
        starts_on: graph.intake.starts_on,
      },
      { onConflict: "student_id,academic_year_id" }
    )
    .select("id")
    .single();
  if (eErr || !enrolment) throw new Error(eErr?.message ?? "enrolment upsert failed");

  return { studentId, enrolmentId: enrolment.id, created: !existing.data };
}
