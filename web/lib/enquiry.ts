import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { CampusRow, EntryRoute, GradeRow, IntakeRow } from "@/lib/supabase/types";
import { normaliseEmail, normaliseMobile, tidyName } from "@/lib/contacts";
import { recommendGrade } from "@/lib/grades";

/**
 * What the funnel needs to render, and how it turns eight fields into an
 * application. Service-role reads of reference data — a parent has no
 * session yet, and this is the public catalogue.
 */

export type FunnelCatalogue = {
  campuses: CampusRow[];
  grades: GradeRow[];
  /** campus id → grade ids it offers */
  offered: Record<string, string[]>;
  intakes: Array<IntakeRow & { age_cutoff_on: string }>;
};

export async function loadCatalogue(admin: AdminClient): Promise<FunnelCatalogue> {
  const today = new Date().toISOString().slice(0, 10);
  const [campusesRes, gradesRes, offeredRes, intakesRes] = await Promise.all([
    admin.from("campuses").select("*").eq("is_active", true).order("sort_order"),
    admin.from("grades").select("*").eq("is_active", true).order("sort_order"),
    admin.from("campus_grades").select("campus_id, grade_id").eq("is_active", true),
    admin
      .from("intakes")
      .select("*, academic_years(age_cutoff_on)")
      .eq("is_open", true)
      .gte("starts_on", today)
      .order("starts_on"),
  ]);
  for (const r of [campusesRes, gradesRes, offeredRes, intakesRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const offered: Record<string, string[]> = {};
  for (const row of offeredRes.data ?? []) {
    (offered[row.campus_id] ??= []).push(row.grade_id);
  }
  const intakes = (intakesRes.data ?? []).map((row) => {
    const ay = Array.isArray(row.academic_years) ? row.academic_years[0] : row.academic_years;
    const intake: IntakeRow = {
      id: row.id,
      academic_year_id: row.academic_year_id,
      term: row.term,
      label: row.label,
      starts_on: row.starts_on,
      is_open: row.is_open,
      sort_order: row.sort_order,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    return {
      ...intake,
      age_cutoff_on: (ay as { age_cutoff_on: string } | null)?.age_cutoff_on ?? "",
    };
  });
  return {
    campuses: campusesRes.data ?? [],
    grades: gradesRes.data ?? [],
    offered,
    intakes,
  };
}

export type EnquiryInput = {
  parentFirstName: string;
  parentLastName: string;
  email: string;
  mobile: string;
  childFirstName: string;
  childLastName: string;
  childDateOfBirth: string;
  campusId: string;
  intakeId: string | null;
  entryRoute: EntryRoute;
  currentSchool?: string | null;
  currentGrade?: string | null;
  /** The parent ticked "also on WhatsApp". */
  whatsappOptIn?: boolean;
};

export type EnquiryResult = {
  applicationId: string;
  reference: string;
  created: boolean;
  gradeId: string;
  recommendedGradeId: string | null;
  intakeId: string;
};

/**
 * Creates (or finds) the application. Picks the intake if the parent did
 * not, recommends a grade from the date of birth, and stores both. Whether
 * the campus offers that grade is resolved on the next screen, where the
 * parent can see the explanation.
 */
export async function createEnquiry(
  admin: AdminClient,
  catalogue: FunnelCatalogue,
  input: EnquiryInput
): Promise<EnquiryResult> {
  const campus = catalogue.campuses.find((c) => c.id === input.campusId);
  if (!campus) throw new Error("campus_not_found");

  const intake =
    catalogue.intakes.find((i) => i.id === input.intakeId) ?? catalogue.intakes[0];
  if (!intake) throw new Error("no_open_intake");

  const rec = recommendGrade(input.childDateOfBirth, intake.age_cutoff_on, catalogue.grades);
  const offeredHere = catalogue.offered[campus.id] ?? [];
  let gradeId: string;
  let recommendedGradeId: string | null = null;
  if (rec.kind === "grade") {
    gradeId = rec.grade.id;
    recommendedGradeId = rec.grade.id;
  } else {
    // No age match. Park the application on the campus's highest grade so
    // it exists; the confirmation screen asks the parent to choose.
    const highest = catalogue.grades.filter((g) => offeredHere.includes(g.id)).at(-1) ??
      catalogue.grades.at(-1);
    if (!highest) throw new Error("no_grades");
    gradeId = highest.id;
  }

  const { data, error } = await admin.rpc("create_application", {
    p_parent_first_name: tidyName(input.parentFirstName),
    p_parent_last_name: tidyName(input.parentLastName),
    p_email: input.email.trim(),
    p_email_normalised: normaliseEmail(input.email),
    p_mobile: input.mobile.trim() || null,
    p_mobile_normalised: normaliseMobile(input.mobile),
    p_child_first_name: tidyName(input.childFirstName),
    p_child_last_name: tidyName(input.childLastName),
    p_child_date_of_birth: input.childDateOfBirth,
    p_campus_id: campus.id,
    p_grade_id: gradeId,
    p_recommended_grade_id: recommendedGradeId,
    p_intake_id: intake.id,
    p_entry_route: input.entryRoute,
    p_source: "website",
    p_current_school: input.currentSchool?.trim() || null,
    p_current_grade: input.currentGrade?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("create_application returned nothing");

  // Opt-in is only ever switched on by the parent's own tick. A returning
  // parent who leaves the box clear keeps whatever they chose before.
  if (input.whatsappOptIn) {
    await admin
      .from("contacts")
      .update({ whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "enquiry", whatsapp_opt_out_at: null })
      .eq("id", row.contact_id);
  }

  return {
    applicationId: row.application_id,
    reference: row.reference,
    created: row.created,
    gradeId,
    recommendedGradeId,
    intakeId: intake.id,
  };
}

export type SlotDay = {
  date: string;
  label: string;
  slots: Array<{
    sessionId: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    placesLeft: number;
  }>;
};

/** Published, future sessions at a campus with places left, for one grade. */
export async function loadAvailableSlots(
  admin: AdminClient,
  opts: { campusId: string; kind: "assessment" | "visit"; gradeSort: number }
): Promise<SlotDay[]> {
  const { data: sessions, error } = await admin
    .from("sessions")
    .select("id, starts_at, ends_at, capacity, location, min_grade_sort, max_grade_sort")
    .eq("campus_id", opts.campusId)
    .eq("kind", opts.kind)
    .eq("is_published", true)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(60);
  if (error) throw new Error(error.message);

  const eligible = (sessions ?? []).filter(
    (s) =>
      (s.min_grade_sort === null || opts.gradeSort >= s.min_grade_sort) &&
      (s.max_grade_sort === null || opts.gradeSort <= s.max_grade_sort)
  );
  if (eligible.length === 0) return [];

  const { data: taken, error: tErr } = await admin
    .from("bookings")
    .select("session_id")
    .in("session_id", eligible.map((s) => s.id))
    .in("status", ["booked", "checked_in", "in_progress", "completed"]);
  if (tErr) throw new Error(tErr.message);
  const counts = new Map<string, number>();
  for (const b of taken ?? []) counts.set(b.session_id, (counts.get(b.session_id) ?? 0) + 1);

  const dayFmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Gaborone",
  });
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Gaborone",
  });

  const days = new Map<string, SlotDay>();
  for (const s of eligible) {
    const left = s.capacity - (counts.get(s.id) ?? 0);
    if (left <= 0) continue;
    const start = new Date(s.starts_at);
    const key = dayKey.format(start);
    const day = days.get(key) ?? { date: key, label: dayFmt.format(start), slots: [] };
    day.slots.push({
      sessionId: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      location: s.location,
      placesLeft: left,
    });
    days.set(key, day);
  }
  return [...days.values()];
}
