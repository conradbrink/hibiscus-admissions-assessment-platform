import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { FamilySession } from "@/lib/tokens/session";
import type { Json, OnboardingStepRow, StudentOnboardingItemRow } from "@/lib/supabase/types";
import { loadFamilyStudents, NotInFamilyError, type FamilyStudent } from "@/lib/family/scope";

/**
 * A family's checklists, through the scoped loaders.
 *
 * Same rule as everything else under `/family`: start from the verified
 * session, narrow to what belongs to it, and check any id that arrived from
 * a form against that set before writing. There is no RLS here to catch a
 * forged one.
 */

export type ChecklistChild = {
  student: FamilyStudent;
  items: Array<StudentOnboardingItemRow & { step: OnboardingStepRow }>;
};

export async function loadFamilyChecklists(
  admin: AdminClient,
  session: FamilySession
): Promise<{ steps: OnboardingStepRow[]; children: ChecklistChild[] }> {
  const students = await loadFamilyStudents(admin, session);
  if (students.length === 0) return { steps: [], children: [] };

  const [{ data: steps, error: sErr }, { data: items, error: iErr }] = await Promise.all([
    admin.from("onboarding_steps").select("*").order("sort_order"),
    admin
      .from("student_onboarding_items")
      .select("*")
      .in(
        "student_id",
        students.map((s) => s.id)
      ),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (iErr) throw new Error(iErr.message);

  const byCode = new Map((steps ?? []).map((s) => [s.code, s]));
  const children = students.map((student) => ({
    student,
    items: (items ?? [])
      .filter((i) => i.student_id === student.id)
      .flatMap((i) => {
        const step = byCode.get(i.step_code);
        // A step retired after a child's checklist was opened: their item
        // stays in the database as the record, and simply stops being asked
        // for. Dropping the row instead would lose that it was ever asked.
        return step ? [{ ...i, step }] : [];
      }),
  }));

  return { steps: steps ?? [], children };
}

/**
 * A parent completes one item. The id is checked against this family's own
 * items, and against the step's owner: the school's own promises — allocate
 * the class, send the pack — are not a parent's to tick off.
 */
export async function completeItem(
  admin: AdminClient,
  session: FamilySession,
  itemId: string,
  value: Json
): Promise<void> {
  const { children } = await loadFamilyChecklists(admin, session);
  const found = children.flatMap((c) => c.items).find((i) => i.id === itemId);
  if (!found) throw new NotInFamilyError("item");
  if (found.step.owner === "staff") throw new NotInFamilyError("item");

  const { error } = await admin
    .from("student_onboarding_items")
    .update({
      status: "done",
      value,
      completed_at: new Date().toISOString(),
      completed_by: "parent",
    })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}
