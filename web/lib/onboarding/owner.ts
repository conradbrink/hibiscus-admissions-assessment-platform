import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Who owns a piece of onboarding work for a child.
 *
 * The person who owned the application: they walked the family in, they know
 * the child's name without looking it up, and the family already knows them.
 *
 * This matters more than it looks. Almost every task in this system is created
 * unassigned, which means it lands on the campus list and in nobody's badge —
 * and a reminder nobody personally owns is not a reminder. Resolving an owner
 * here is what makes the topbar count, the dashboard's "my tasks" and
 * `/staff/tasks?filter=mine` light up for onboarding at all.
 *
 * Null is an honest answer: an application nobody owned, or a child imported
 * without one. The task still exists and is still campus-scoped; it simply
 * waits on the shared list for someone to pick up.
 */
export async function ownerForStudent(admin: AdminClient, studentId: string): Promise<string | null> {
  const { data: student } = await admin
    .from("students")
    .select("origin_application_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!student?.origin_application_id) return null;

  const { data: application } = await admin
    .from("applications")
    .select("owner_staff_id")
    .eq("id", student.origin_application_id)
    .maybeSingle();
  const ownerId = application?.owner_staff_id ?? null;
  if (!ownerId) return null;

  // Somebody who has left should not be holding a task. The list treats an
  // inactive assignee as a live one, so the work would sit in a badge nobody
  // looks at rather than on the campus list where it can be picked up.
  const { data: staff } = await admin
    .from("staff_profiles")
    .select("id")
    .eq("id", ownerId)
    .eq("is_active", true)
    .maybeSingle();
  return staff?.id ?? null;
}
