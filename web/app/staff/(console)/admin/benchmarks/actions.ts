"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { BENCHMARK_BANDS_SCHEMA, BENCHMARK_BAND_KEYS } from "@/lib/assessment/bands";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  benchmarkId: z.uuid().optional().or(z.literal("")),
  scope: z.enum(["overall", "subject", "competency"]),
  scopeId: z.string().optional(),
  gradeSortMin: z.union([z.literal(""), z.coerce.number().int()]).optional(),
  gradeSortMax: z.union([z.literal(""), z.coerce.number().int()]).optional(),
  description: z.string().trim().max(300).optional(),
  isActive: z.string().optional(),
  approaching: z.coerce.number().min(1).max(100),
  meeting: z.coerce.number().min(1).max(100),
  exceeding: z.coerce.number().min(1).max(100),
});

/** Bands are entered as three floors; "below" always starts at 0. */
export async function saveBenchmark(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = schema.parse(Object.fromEntries(formData));
    if (!(p.approaching < p.meeting && p.meeting < p.exceeding)) throw new Error("Floors must rise: approaching < meeting < exceeding.");
    const bands = BENCHMARK_BANDS_SCHEMA.parse(
      BENCHMARK_BAND_KEYS.map((key) => ({
        key,
        min_percent: key === "below" ? 0 : key === "approaching" ? p.approaching : key === "meeting" ? p.meeting : p.exceeding,
      }))
    );
    const scopeId = p.scope === "overall" ? null : p.scopeId || null;
    if (p.scope !== "overall" && !scopeId) throw new Error("Choose which subject or competency this applies to.");
    const row = {
      scope: p.scope,
      scope_id: scopeId,
      grade_sort_min: p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin,
      grade_sort_max: p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax,
      bands,
      description: p.description || null,
      is_active: p.benchmarkId ? p.isActive === "1" : true,
    };
    const { error } = p.benchmarkId
      ? await ctx.supabase.from("benchmarks").update(row).eq("id", p.benchmarkId)
      : await ctx.supabase.from("benchmarks").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/benchmarks");
  });
}
