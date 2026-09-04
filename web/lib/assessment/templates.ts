import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AssessmentTemplateRow } from "@/lib/supabase/types";

/**
 * Which template a child sits: the active one whose grade band contains
 * their grade, preferring one pinned to their campus over a global one, and
 * the most recently updated when more than one qualifies.
 */
export async function resolveTemplate(
  admin: AdminClient,
  opts: { campusId: string; gradeSort: number }
): Promise<AssessmentTemplateRow | null> {
  const { data, error } = await admin
    .from("assessment_templates")
    .select("*")
    .eq("status", "active")
    .lte("grade_sort_min", opts.gradeSort)
    .gte("grade_sort_max", opts.gradeSort)
    .or(`campus_id.eq.${opts.campusId},campus_id.is.null`)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return rows.find((t) => t.campus_id === opts.campusId) ?? rows.find((t) => t.campus_id === null) ?? null;
}
