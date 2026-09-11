import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { applicableItems, optionsOf, isOrderable, type ItemLike } from "@/lib/extras/catalogue";
import { loadFamilyStudents, requireStudentInFamily, type FamilyStudent } from "@/lib/family/scope";
import type { FamilySession } from "@/lib/tokens/session";
import type { OptionalItemRow, StudentOptionalSelectionRow } from "@/lib/supabase/types";

/**
 * The extras a family may order, and what they have ordered, through the
 * scoped loaders.
 *
 * Same rule as everything else under `/family`: start from the verified
 * session, narrow to what belongs to it, and check any id that arrived from a
 * form against that set before writing. There is no RLS behind a parent
 * session to catch a forged one — `scope.test.ts` is what keeps a page from
 * going around this module.
 */

export type ExtrasChild = {
  student: FamilyStudent;
  items: OptionalItemRow[];
  selections: StudentOptionalSelectionRow[];
};

export async function loadFamilyExtras(admin: AdminClient, session: FamilySession): Promise<ExtrasChild[]> {
  const students = await loadFamilyStudents(admin, session);
  if (students.length === 0) return [];

  const campusIds = [...new Set(students.map((s) => s.current_campus_id).filter((v): v is string => Boolean(v)))];
  const [{ data: items, error: iErr }, { data: selections, error: sErr }] = await Promise.all([
    campusIds.length
      ? admin.from("optional_items").select("*").in("campus_id", campusIds).eq("is_active", true).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("student_optional_selections")
      .select("*")
      .in(
        "student_id",
        students.map((s) => s.id)
      ),
  ]);
  if (iErr) throw new Error(iErr.message);
  if (sErr) throw new Error(sErr.message);

  return students.map((student) => ({
    student,
    items: applicableItems((items ?? []) as unknown as ItemLike[], {
      campusId: student.current_campus_id ?? "",
      gradeSort: student.grade?.sort_order ?? null,
    }) as unknown as OptionalItemRow[],
    selections: (selections ?? []).filter((s) => s.student_id === student.id),
  }));
}

export type ChooseInput = {
  studentId: string;
  itemId: string;
  quantity: number;
  choice: string | null;
};

/**
 * A family chooses an extra, or changes what they chose.
 *
 * Everything that arrived from the form is checked against the session and
 * the catalogue before anything is written: the child must be theirs, the
 * item must be one their child is actually offered, the choice must be one
 * the item lists, and the quantity must be one the item allows. The price is
 * taken from the catalogue rather than the form — a parent posting their own
 * `amount_minor` is the obvious attack, and the form never sends one.
 */
export async function chooseExtra(
  admin: AdminClient,
  session: FamilySession,
  input: ChooseInput,
  today: string
): Promise<void> {
  const student = await requireStudentInFamily(admin, session, input.studentId);

  const { data: item, error } = await admin.from("optional_items").select("*").eq("id", input.itemId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) throw new Error("That item is no longer available.");

  // Offered to *this* child, not merely to somebody: the band and the campus
  // both have to match, which is the same check the page rendered from.
  const offered = applicableItems([item as unknown as ItemLike], {
    campusId: student.current_campus_id ?? "",
    gradeSort: student.grade?.sort_order ?? null,
  });
  if (!offered.length) throw new Error("That item is not available for this child.");
  if (!isOrderable(item as unknown as ItemLike, today)) {
    throw new Error("The date for ordering this has passed. Call the office and we will see what we can do.");
  }

  const options = optionsOf(item.options);
  if (options.length && (!input.choice || !options.includes(input.choice))) {
    throw new Error("Choose one of the options listed.");
  }
  const quantity = item.allow_quantity ? Math.max(1, Math.min(input.quantity, 20)) : 1;

  const { error: wErr } = await admin.from("student_optional_selections").upsert(
    {
      student_id: student.id,
      item_id: item.id,
      campus_id: item.campus_id,
      quantity,
      choice: options.length ? input.choice : null,
      unit_amount_minor: item.amount_minor,
      currency: item.currency,
      status: "selected",
      cancelled_at: null,
    },
    { onConflict: "student_id,item_id" }
  );
  if (wErr) throw new Error(wErr.message);
}

/**
 * A family changes its mind.
 *
 * Cancelled rather than deleted: the office may already have counted it into
 * an order, and a line that vanishes is a conversation nobody can reconstruct.
 * Something already paid for is not cancellable here — that is a refund, and a
 * refund is a person's decision.
 */
export async function cancelExtra(
  admin: AdminClient,
  session: FamilySession,
  input: { studentId: string; selectionId: string }
): Promise<void> {
  const student = await requireStudentInFamily(admin, session, input.studentId);
  const { error } = await admin
    .from("student_optional_selections")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", input.selectionId)
    .eq("student_id", student.id)
    .eq("status", "selected");
  if (error) throw new Error(error.message);
}
