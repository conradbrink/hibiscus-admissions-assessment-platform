import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { FeeLineRow, FeeScheduleRow, OfferTemplateRow } from "@/lib/supabase/types";

export { buildOfferVariables, feeSnapshotFrom, renderOffer, snapshotFees, type FeeSnapshot } from "@/lib/offers/snapshot";

/**
 * Turning an application into an offer document. The fee schedule is
 * resolved for the campus, academic year and grade; the active template is
 * rendered with the same allow-listed variable syntax as email; the result
 * is what gets snapshotted onto the offer row. The pure steps live in
 * `snapshot.ts`; this file is the database side.
 */

/** The active schedule whose band contains the grade; a narrower band beats a wider one. */
export async function resolveFeeSchedule(
  admin: AdminClient,
  opts: { campusId: string; academicYearId: string; gradeSort: number }
): Promise<{ schedule: FeeScheduleRow; lines: FeeLineRow[] } | null> {
  const { data, error } = await admin
    .from("fee_schedules")
    .select("*, fee_lines(*)")
    .eq("campus_id", opts.campusId)
    .eq("academic_year_id", opts.academicYearId)
    .eq("status", "active")
    .or(`grade_sort_min.is.null,grade_sort_min.lte.${opts.gradeSort}`)
    .or(`grade_sort_max.is.null,grade_sort_max.gte.${opts.gradeSort}`)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const width = (s: FeeScheduleRow) => (s.grade_sort_max ?? 10_000) - (s.grade_sort_min ?? 0);
  const chosen = [...rows].sort((a, b) => width(a) - width(b))[0];
  if (!chosen) return null;
  const { fee_lines, ...schedule } = chosen;
  return { schedule, lines: [...(fee_lines ?? [])].sort((a, b) => a.position - b.position) };
}

export async function loadActiveOfferTemplate(admin: AdminClient, key = "standard"): Promise<OfferTemplateRow | null> {
  const { data, error } = await admin.from("offer_templates").select("*").eq("key", key).eq("is_active", true).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
