"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { parseMoneyToMinor } from "@/lib/money";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

const CODE = /^[a-z0-9_]+$/;
const CATEGORIES = ["activity", "service", "programme", "enrolment", "other"] as const;

export async function saveOpportunityType(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({
      code: z.string().trim().regex(CODE, "A code is lower-case letters, digits and _."),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500).optional().or(z.literal("")),
      category: z.enum(CATEGORIES).default("other"),
      defaultValue: z.string().trim().optional().or(z.literal("")),
      optionalItemCode: z.string().trim().optional().or(z.literal("")),
      sortOrder: z.coerce.number().int().default(0),
      isActive: z.string().optional(),
    }).parse(Object.fromEntries(formData));
    const value = p.defaultValue ? parseMoneyToMinor(p.defaultValue) : null;
    if (p.defaultValue && value === null) throw new Error("The value must be a number, for example 1500.");
    if (p.optionalItemCode && !CODE.test(p.optionalItemCode)) throw new Error("The catalogue code is lower-case letters, digits and _.");
    const { error } = await ctx.supabase.from("opportunity_types").upsert({ code: p.code, name: p.name, description: p.description || null, category: p.category, default_value_minor: value, optional_item_code: p.optionalItemCode || null, sort_order: p.sortOrder, is_active: p.isActive === "on" }, { onConflict: "code" });
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "opportunity_type.saved", entityType: "automation", after: { code: p.code, name: p.name, default_value_minor: value, is_active: p.isActive === "on" } });
    revalidatePath("/staff/crm/settings/opportunity-types");
  });
}

export async function saveOpportunityRule(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({
      code: z.string().trim().regex(CODE, "A code is lower-case letters, digits and _."),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500).optional().or(z.literal("")),
      typeCode: z.string().trim().regex(CODE),
      conditions: z.string(),
      estimatedValue: z.string().trim().optional().or(z.literal("")),
      sortOrder: z.coerce.number().int().default(0),
      isActive: z.string().optional(),
    }).parse(Object.fromEntries(formData));
    let conditions: unknown;
    try {
      conditions = JSON.parse(p.conditions || "{}");
    } catch {
      throw new Error("Conditions must be valid JSON.");
    }
    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) throw new Error("Conditions must be an object.");
    const value = p.estimatedValue ? parseMoneyToMinor(p.estimatedValue) : null;
    if (p.estimatedValue && value === null) throw new Error("The value must be a number.");
    const { error } = await ctx.supabase.from("opportunity_rules").upsert({ code: p.code, name: p.name, description: p.description || null, type_code: p.typeCode, conditions: conditions as Json, estimated_value_minor: value, sort_order: p.sortOrder, is_active: p.isActive === "on" }, { onConflict: "code" });
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "opportunity_rule.saved", entityType: "automation", after: { code: p.code, conditions: conditions as Json, is_active: p.isActive === "on" } });
    revalidatePath("/staff/crm/settings/opportunity-rules");
  });
}

/** The CRM's own rows in `settings`, edited with the same shapes the workflow editor accepts. */
export async function saveCrmSetting(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ key: z.string().regex(/^crm_[a-z0-9_]+$/), value: z.string().trim().min(1).max(50) }).parse(Object.fromEntries(formData));
    let value: unknown;
    try {
      value = JSON.parse(p.value);
    } catch {
      throw new Error("Enter true, false or a whole number.");
    }
    const ok = typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value) && value > 0);
    if (!ok) throw new Error("Enter true, false or a positive whole number.");
    const { data: before } = await ctx.supabase.from("settings").select("value").eq("key", p.key).maybeSingle();
    const { error } = await ctx.supabase.from("settings").update({ value: value as boolean | number, updated_by: ctx.userId }).eq("key", p.key);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "crm_setting.changed", entityType: "automation", before: { key: p.key, value: before?.value ?? null }, after: { key: p.key, value: value as Json } });
    revalidatePath("/staff/crm/settings", "layout");
  });
}
