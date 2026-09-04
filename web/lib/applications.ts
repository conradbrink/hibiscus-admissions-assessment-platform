import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type {
  ApplicationRow,
  BookingRow,
  CampusRow,
  ContactRow,
  GradeRow,
  IntakeRow,
  SessionRow,
} from "@/lib/supabase/types";

/**
 * Loading an application and everything the parent journey needs alongside
 * it. Service-role reads, so every function here takes an `applicationId`
 * that the caller has already established the right to — from a verified
 * parent session, or from a staff request that RLS has already answered.
 */

export type ApplicationGraph = {
  application: ApplicationRow;
  contact: ContactRow;
  campus: CampusRow;
  grade: GradeRow;
  intake: IntakeRow;
  /** The one live booking, with its session, or null. */
  booking: (BookingRow & { session: SessionRow }) | null;
};

export async function loadApplicationGraph(
  admin: AdminClient,
  applicationId: string
): Promise<ApplicationGraph | null> {
  const { data: application, error } = await admin
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!application) return null;

  const [contactRes, campusRes, gradeRes, intakeRes, bookingRes] = await Promise.all([
    admin.from("contacts").select("*").eq("id", application.contact_id).single(),
    admin.from("campuses").select("*").eq("id", application.campus_id).single(),
    admin.from("grades").select("*").eq("id", application.grade_id).single(),
    admin.from("intakes").select("*").eq("id", application.intake_id).single(),
    admin
      .from("bookings")
      .select("*")
      .eq("application_id", applicationId)
      .in("status", ["booked", "checked_in", "in_progress"])
      .order("booked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const r of [contactRes, campusRes, gradeRes, intakeRes, bookingRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  let booking: ApplicationGraph["booking"] = null;
  if (bookingRes.data) {
    const { data: session, error: sErr } = await admin
      .from("sessions")
      .select("*")
      .eq("id", bookingRes.data.session_id)
      .single();
    if (sErr) throw new Error(sErr.message);
    booking = { ...bookingRes.data, session };
  }

  return {
    application,
    contact: contactRes.data!,
    campus: campusRes.data!,
    grade: gradeRes.data!,
    intake: intakeRes.data!,
    booking,
  };
}

/**
 * Every non-withdrawn application for the same parent. A family with two
 * children sees both from either child's link.
 */
export async function loadSiblingApplications(
  admin: AdminClient,
  contactId: string
): Promise<
  Array<
    Pick<
      ApplicationRow,
      "id" | "reference" | "child_first_name" | "child_last_name" | "status" | "next_action"
    > & { campus_name: string; grade_name: string }
  >
> {
  const { data, error } = await admin
    .from("applications")
    .select(
      "id, reference, child_first_name, child_last_name, status, next_action, campuses(name), grades!applications_grade_id_fkey(name)"
    )
    .eq("contact_id", contactId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    // Embedded relations come back as an object or an array depending on
    // the relationship; normalise rather than guess.
    const campus = Array.isArray(row.campuses) ? row.campuses[0] : row.campuses;
    const grade = Array.isArray(row.grades) ? row.grades[0] : row.grades;
    return {
      id: row.id,
      reference: row.reference,
      child_first_name: row.child_first_name,
      child_last_name: row.child_last_name,
      status: row.status,
      next_action: row.next_action,
      campus_name: (campus as { name: string } | null)?.name ?? "",
      grade_name: (grade as { name: string } | null)?.name ?? "",
    };
  });
}
