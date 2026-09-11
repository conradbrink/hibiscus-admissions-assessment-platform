import "server-only";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { FamilySession } from "@/lib/tokens/session";
import type { EnrolmentRow, FamilyRow, StudentRow } from "@/lib/supabase/types";

/**
 * The only door onto a family's own data.
 *
 * Parents are not database principals, so there is no RLS behind these
 * reads — the service role will hand back any row it is asked for. In the
 * funnel that risk was bounded: a session named one application and a missed
 * `.eq()` leaked one child. A family session names a whole family, so the
 * same slip would leak somebody else's children, their medical facts and
 * their documents.
 *
 * So the rule is made structural rather than left to vigilance. Every read
 * under `app/(parent)/family` goes through this module; every function takes
 * the verified session, never a raw id; and anything that arrives from a form
 * is checked against the session before it is used. `scope.test.ts` walks the
 * family routes and fails the build if any of them queries these tables
 * directly — the same trick `lib/assessment/delivery.test.ts` uses to keep
 * answers off the kiosk.
 */

export class NotInFamilyError extends Error {
  constructor(what: string) {
    super(`That ${what} does not belong to this family.`);
    this.name = "NotInFamilyError";
  }
}

/** The service-role client. Kept here so a family page never makes its own. */
export function familyClient(): AdminClient {
  return createAdminClient();
}

export type FamilyStudent = StudentRow & {
  campus: { name: string } | null;
  /** `sort_order` comes along because the grade bands on the optional extras
   *  and the checklist steps are expressed in it, not in the grade's name. */
  grade: { name: string; sort_order: number } | null;
};

export async function loadFamily(admin: AdminClient, session: FamilySession): Promise<FamilyRow | null> {
  const { data, error } = await admin
    .from("families")
    .select("*")
    .eq("id", session.familyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Every child of this family, youngest last. Never takes a student id. */
export async function loadFamilyStudents(
  admin: AdminClient,
  session: FamilySession
): Promise<FamilyStudent[]> {
  const { data, error } = await admin
    .from("students")
    .select("*, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name, sort_order)")
    .eq("family_id", session.familyId)
    .in("status", ["onboarding", "active", "on_leave"])
    .order("date_of_birth");
  if (error) throw new Error(error.message);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  return (data ?? []).map((row) => {
    const { campuses, grades, ...student } = row;
    return { ...student, campus: one(campuses), grade: one(grades) } as FamilyStudent;
  });
}

/**
 * A student id that arrived from a form, checked against the session before
 * anything reads it. Throws rather than returning null: a caller that forgets
 * to handle "not yours" should fail loudly, not fall through to a page.
 */
export async function requireStudentInFamily(
  admin: AdminClient,
  session: FamilySession,
  studentId: string
): Promise<FamilyStudent> {
  const students = await loadFamilyStudents(admin, session);
  const found = students.find((s) => s.id === studentId);
  if (!found) throw new NotInFamilyError("child");
  return found;
}

/** The years this family's children are enrolled for, newest first. */
export async function loadFamilyEnrolments(
  admin: AdminClient,
  session: FamilySession
): Promise<EnrolmentRow[]> {
  const students = await loadFamilyStudents(admin, session);
  if (students.length === 0) return [];
  const { data, error } = await admin
    .from("enrolments")
    .select("*")
    .in(
      "student_id",
      students.map((s) => s.id)
    )
    .order("starts_on", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The contacts on this family, for showing what we hold and asking them to confirm it. */
export async function loadFamilyContacts(admin: AdminClient, session: FamilySession) {
  const { data, error } = await admin
    .from("contacts")
    .select("id, first_name, last_name, email, mobile, whatsapp_opt_in")
    .eq("family_id", session.familyId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}
