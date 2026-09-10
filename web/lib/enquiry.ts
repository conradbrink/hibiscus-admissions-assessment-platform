import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationSource, CampusRow, EntryRoute, GradeRow, IntakeRow } from "@/lib/supabase/types";
import type { HeardFrom } from "@/lib/heard-from";
import { normaliseEmail, normaliseMobile, tidyName } from "@/lib/contacts";
import { recommendGrade } from "@/lib/grades";
import { offerableIntakes } from "@/lib/intakes";

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
  /**
   * campus id → grade id → whether that class is assessed *there*. Reception
   * is assessed at Block 7 and is an ordinary pre-school class at Bana
   * Tlokweng, so the question cannot be answered by the grade alone.
   */
  assessed: Record<string, Record<string, boolean>>;
  intakes: Array<IntakeRow & { age_cutoff_on: string }>;
};

export async function loadCatalogue(admin: AdminClient): Promise<FunnelCatalogue> {
  const today = new Date().toISOString().slice(0, 10);
  const [campusesRes, gradesRes, offeredRes, intakesRes] = await Promise.all([
    admin.from("campuses").select("*").eq("is_active", true).order("sort_order"),
    admin.from("grades").select("*").eq("is_active", true).order("sort_order"),
    admin.from("campus_grades").select("campus_id, grade_id, requires_assessment").eq("is_active", true),
    // Every open term, past starts included: `offerableIntakes` decides which
    // are still joinable, because "the term running now" needs the academic
    // year's end date and not just a comparison against today.
    admin
      .from("intakes")
      .select("*, academic_years(age_cutoff_on, ends_on)")
      .eq("is_open", true)
      .order("starts_on"),
  ]);
  for (const r of [campusesRes, gradesRes, offeredRes, intakesRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const offered: Record<string, string[]> = {};
  const gradeAssessed = new Map((gradesRes.data ?? []).map((g) => [g.id, g.requires_assessment]));
  const assessed: Record<string, Record<string, boolean>> = {};
  for (const row of offeredRes.data ?? []) {
    (offered[row.campus_id] ??= []).push(row.grade_id);
    (assessed[row.campus_id] ??= {})[row.grade_id] =
      row.requires_assessment ?? gradeAssessed.get(row.grade_id) ?? false;
  }
  const dated = (intakesRes.data ?? []).map((row) => {
    const ay = Array.isArray(row.academic_years) ? row.academic_years[0] : row.academic_years;
    const year = ay as { age_cutoff_on: string; ends_on: string } | null;
    return { row, age_cutoff_on: year?.age_cutoff_on ?? "", year_ends_on: year?.ends_on ?? null };
  });

  const intakes = offerableIntakes(
    dated.map((d) => ({ ...d, starts_on: d.row.starts_on, is_open: d.row.is_open })),
    today
  ).map(({ row, age_cutoff_on }) => {
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
    return { ...intake, age_cutoff_on };
  });
  return {
    campuses: campusesRes.data ?? [],
    grades: gradesRes.data ?? [],
    offered,
    assessed,
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
  /** "How did you hear about us?" — a key from HEARD_FROM_OPTIONS, and a free line when it is "other". */
  heardFrom?: HeardFrom | null;
  heardFromDetail?: string | null;
  /**
   * Which door this came through. The parent's own form is "website"; the
   * front desk typing it for a family standing there is "walk_in".
   */
  source?: ApplicationSource;
  /**
   * The grade, when someone has chosen it — the front desk, with the family
   * in front of them and a school report in hand, knows better than the date
   * of birth alone. Left out, the age recommendation decides.
   */
  gradeId?: string | null;
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

  // Recommend from the ladder this campus actually teaches. The two ladders
  // share ages — a child turning four is Grade RR in Potchefstroom and
  // Pre-Reception in Gaborone — and the South African grades sort first, so
  // recommending across the whole catalogue answered every Botswana enquiry
  // with a South African class. Which ruleset a campus follows is not a rule
  // in code: it is whichever grades the campus offers.
  const offeredHere = catalogue.offered[campus.id] ?? [];
  const gradesHere = catalogue.grades.filter((g) => offeredHere.includes(g.id));
  const rec = recommendGrade(
    input.childDateOfBirth,
    intake.age_cutoff_on,
    gradesHere.length > 0 ? gradesHere : catalogue.grades
  );
  let gradeId: string;
  let recommendedGradeId: string | null = null;
  if (rec.kind === "grade") recommendedGradeId = rec.grade.id;
  // A grade someone chose wins over the age recommendation, but the
  // recommendation is still recorded, so the two can be compared later.
  const chosen = input.gradeId && catalogue.grades.some((g) => g.id === input.gradeId) ? input.gradeId : null;
  if (chosen) {
    gradeId = chosen;
  } else if (rec.kind === "grade") {
    gradeId = rec.grade.id;
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
    p_source: input.source ?? "website",
    p_current_school: input.currentSchool?.trim() || null,
    p_current_grade: input.currentGrade?.trim() || null,
    p_heard_from: input.heardFrom ?? null,
    p_heard_from_detail: input.heardFrom === "other" ? input.heardFromDetail?.trim() || null : null,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("create_application returned nothing");

  // Opt-in is only ever switched on by the parent's own tick. A returning
  // parent who leaves the box clear keeps whatever they chose before.
  if (input.whatsappOptIn) {
    await admin
      .from("contacts")
      .update({
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date().toISOString(),
        // Who recorded the consent: the parent on the form, or a member of
        // staff repeating what the parent said at the desk.
        whatsapp_opt_in_source: input.source && input.source !== "website" ? "staff" : "enquiry",
        whatsapp_opt_out_at: null,
      })
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
    // Read enough to cover the whole horizon: the cap is applied before the
    // grade band and the places-left filter below, so a short read hides
    // dates that exist rather than showing fewer of them. Six weeks of
    // weekdays at three sittings a day is ninety.
    .limit(200);
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
