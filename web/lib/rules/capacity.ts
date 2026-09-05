import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationStatus } from "@/lib/supabase/types";

/** Statuses that hold a place: approved and everything after it. */
export const PLACE_HOLDING_STATUSES: ApplicationStatus[] = [
  "approved",
  "offer_draft",
  "offer_pending_approval",
  "offer_sent",
  "offer_accepted",
  "payment_required",
  "payment_processing",
  "paid",
  "registration_incomplete",
  "registration_complete",
  "enrolled",
];

/**
 * Places left for a grade at a campus in the academic year of an intake.
 * Null when the campus_grades row sets no capacity — unlimited.
 */
export async function placesRemaining(
  admin: AdminClient,
  opts: { campusId: string; gradeId: string; intakeId: string; excludeApplicationId?: string }
): Promise<number | null> {
  const [{ data: cg }, { data: intake }] = await Promise.all([
    admin.from("campus_grades").select("capacity").eq("campus_id", opts.campusId).eq("grade_id", opts.gradeId).maybeSingle(),
    admin.from("intakes").select("academic_year_id").eq("id", opts.intakeId).single(),
  ]);
  if (!cg || cg.capacity === null || !intake) return null;

  const { data: yearIntakes } = await admin.from("intakes").select("id").eq("academic_year_id", intake.academic_year_id);
  const intakeIds = (yearIntakes ?? []).map((i) => i.id);
  let q = admin
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("campus_id", opts.campusId)
    .eq("grade_id", opts.gradeId)
    .in("intake_id", intakeIds)
    .in("status", PLACE_HOLDING_STATUSES);
  if (opts.excludeApplicationId) q = q.neq("id", opts.excludeApplicationId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return Math.max(0, cg.capacity - (count ?? 0));
}
