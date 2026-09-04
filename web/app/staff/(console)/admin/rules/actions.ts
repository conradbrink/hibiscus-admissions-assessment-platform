"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Admission rulesets. Drafts are editable; activating freezes one and
 * supersedes the previous active ruleset with the same scope, in the
 * database, atomically. Nothing here evaluates anything.
 */

const path = (id?: string) => (id ? `/staff/admin/rules/${id}` : "/staff/admin/rules");

const meta = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  gradeSortMin: z.union([z.literal(""), z.coerce.number().int()]).optional(),
  gradeSortMax: z.union([z.literal(""), z.coerce.number().int()]).optional(),
  campusId: z.string().optional(),
});

function band(v: "" | number | undefined): number | null {
  return v === "" || v === undefined ? null : v;
}

export async function createRuleset(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = meta.parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("admission_rulesets").insert({
      name: p.name,
      description: p.description || null,
      grade_sort_min: band(p.gradeSortMin),
      grade_sort_max: band(p.gradeSortMax),
      campus_id: p.campusId || null,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(path());
  });
}

export async function saveRuleset(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = meta.extend({ rulesetId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("admission_rulesets")
      .update({
        name: p.name,
        description: p.description || null,
        grade_sort_min: band(p.gradeSortMin),
        grade_sort_max: band(p.gradeSortMax),
        campus_id: p.campusId || null,
      })
      .eq("id", p.rulesetId);
    if (error) throw new Error(error.message);
    revalidatePath(path(p.rulesetId));
    revalidatePath(path());
  });
}

export async function addRule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = z
      .object({
        rulesetId: z.uuid(),
        scope: z.enum(["overall", "subject", "competency"]),
        scopeId: z.string().optional(),
        operator: z.enum([">=", ">", "<=", "<"]),
        threshold: z.coerce.number().min(0).max(100),
        severity: z.enum(["hard_fail", "review"]),
        label: z.string().trim().min(1).max(160),
      })
      .parse(Object.fromEntries(formData));
    const scopeId = p.scope === "overall" ? null : p.scopeId || null;
    if (p.scope !== "overall" && !scopeId) throw new Error("Choose which subject or competency the rule applies to.");
    const { data: existing } = await ctx.supabase
      .from("admission_rules")
      .select("position")
      .eq("ruleset_id", p.rulesetId)
      .order("position", { ascending: false })
      .limit(1);
    const { error } = await ctx.supabase.from("admission_rules").insert({
      ruleset_id: p.rulesetId,
      scope: p.scope,
      scope_id: scopeId,
      operator: p.operator,
      threshold: p.threshold,
      severity: p.severity,
      label: p.label,
      position: (existing?.[0]?.position ?? 0) + 1,
    });
    if (error) throw new Error(error.message);
    revalidatePath(path(p.rulesetId));
  });
}

export async function deleteRule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = z.object({ rulesetId: z.uuid(), ruleId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("admission_rules").delete().eq("id", p.ruleId);
    if (error) throw new Error(error.message);
    revalidatePath(path(p.rulesetId));
  });
}

export async function activateRuleset(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = z.object({ rulesetId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.rpc("activate_ruleset", { p_ruleset_id: p.rulesetId });
    if (error) {
      if (error.message.includes("ruleset_empty")) throw new Error("Add at least one rule before activating.");
      if (error.message.includes("ruleset_not_draft")) throw new Error("Only a draft can be activated.");
      throw new Error(error.message);
    }
    revalidatePath(path(p.rulesetId));
    revalidatePath(path());
  });
}

export async function deleteRuleset(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("rules.write");
    const p = z.object({ rulesetId: z.uuid() }).parse(Object.fromEntries(formData));
    const { data, error } = await ctx.supabase.from("admission_rulesets").delete().eq("id", p.rulesetId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Only a draft ruleset can be deleted.");
    revalidatePath(path());
  });
}
