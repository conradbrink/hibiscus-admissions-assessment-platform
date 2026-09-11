import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { FamilySession } from "@/lib/tokens/session";
import type { ReenrolmentIntent } from "@/lib/supabase/types";
import { loadFamilyStudents, NotInFamilyError, type FamilyStudent } from "@/lib/family/scope";

/**
 * The family's side of a re-enrolment round, through the scoped loaders.
 *
 * Everything here starts from the verified session and narrows to the rows
 * that belong to it. A response id arriving from a form is checked against
 * that set before it is written — never trusted because it was in the page.
 */

export type OpenQuestion = {
  responseId: string;
  student: FamilyStudent;
  intent: ReenrolmentIntent | null;
  answeredAt: string | null;
  cycle: { id: string; name: string; closesOn: string; askDetails: boolean; termLabel: string | null };
};

/**
 * What this family is being asked right now: one question per child, for
 * every round that is open and covers them.
 */
export async function loadOpenQuestions(
  admin: AdminClient,
  session: FamilySession
): Promise<OpenQuestion[]> {
  const students = await loadFamilyStudents(admin, session);
  if (students.length === 0) return [];

  const { data, error } = await admin
    .from("reenrolment_responses")
    .select("id, student_id, intent, answered_at, reenrolment_cycles!inner(id, name, closes_on, ask_details_refresh, status, intakes(label))")
    .in(
      "student_id",
      students.map((s) => s.id)
    )
    .eq("reenrolment_cycles.status", "open");
  if (error) throw new Error(error.message);

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const out: OpenQuestion[] = [];
  for (const row of data ?? []) {
    const student = students.find((s) => s.id === row.student_id);
    const cycle = one(row.reenrolment_cycles);
    if (!student || !cycle) continue;
    out.push({
      responseId: row.id,
      student,
      intent: row.intent,
      answeredAt: row.answered_at,
      cycle: {
        id: cycle.id,
        name: cycle.name,
        closesOn: cycle.closes_on,
        askDetails: cycle.ask_details_refresh,
        termLabel: one(cycle.intakes)?.label ?? null,
      },
    });
  }
  // Oldest child first, so a parent answering for three reads them in the
  // same order every time.
  return out.sort((a, b) => a.student.date_of_birth.localeCompare(b.student.date_of_birth));
}

/**
 * Records one answer. The response id is checked against this family's own
 * open questions first, so a posted id from another family is refused rather
 * than written — there is no RLS behind this client to catch it.
 */
export async function saveAnswer(
  admin: AdminClient,
  session: FamilySession,
  responseId: string,
  intent: ReenrolmentIntent,
  reason: string | null
): Promise<void> {
  const questions = await loadOpenQuestions(admin, session);
  if (!questions.some((q) => q.responseId === responseId)) {
    throw new NotInFamilyError("question");
  }
  const { error } = await admin
    .from("reenrolment_responses")
    .update({
      intent,
      reason,
      answered_at: new Date().toISOString(),
      answered_by: "parent",
    })
    .eq("id", responseId);
  if (error) throw new Error(error.message);
}

/**
 * The other half of the round: the parent confirms what we hold is still
 * true. Stamps the student so the register can show how fresh it is, and the
 * response so the board can show who has done it.
 */
export async function confirmDetails(
  admin: AdminClient,
  session: FamilySession,
  responseId: string,
  changed: string[]
): Promise<void> {
  const questions = await loadOpenQuestions(admin, session);
  const question = questions.find((q) => q.responseId === responseId);
  if (!question) throw new NotInFamilyError("question");

  const now = new Date().toISOString();
  const { error } = await admin
    .from("reenrolment_responses")
    .update({ details_confirmed_at: now, details_changed: changed })
    .eq("id", responseId);
  if (error) throw new Error(error.message);

  const { error: sErr } = await admin
    .from("students")
    .update({ details_confirmed_at: now })
    .eq("id", question.student.id)
    .eq("family_id", session.familyId);
  if (sErr) throw new Error(sErr.message);
}
