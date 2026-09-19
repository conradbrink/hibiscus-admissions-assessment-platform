"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { parseActions, parseConditions } from "@/lib/crm/automations/rules";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

const TRIGGERS = [
  "family.created", "enquiry.created", "application.status_changed", "family.lifecycle_changed",
  "student.enrolled", "student.status_changed", "reenrolment.opened", "reenrolment.asked", "reenrolment.answered",
  "opportunity.created", "opportunity.status_changed", "event.registered", "event.attended",
] as const;

const schema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]+$/, "A code is lower-case letters, digits and _.").max(60),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  triggerType: z.enum(TRIGGERS),
  conditions: z.string(),
  actions: z.string(),
});

function parse(formData: FormData) {
  const p = schema.parse(Object.fromEntries(formData));
  let conditions: unknown;
  let actions: unknown;
  try {
    conditions = p.conditions.trim() ? JSON.parse(p.conditions) : {};
    actions = JSON.parse(p.actions);
  } catch {
    throw new Error("The conditions and actions must be valid JSON.");
  }
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) throw new Error("Conditions must be an object like {\"to\": [\"active\"]}.");
  parseConditions(conditions as Json);
  const parsed = parseActions(actions as Json);
  if (!parsed.ok) throw new Error(parsed.problems.map((x) => x.message).join(" "));
  if (parsed.actions.length === 0) throw new Error("Add at least one action.");
  return { ...p, conditions: conditions as Json, actions: parsed.actions as unknown as Json };
}

export async function createAutomation(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let id: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = parse(formData);
    const { data, error } = await ctx.supabase.from("automations").insert({ code: p.code, name: p.name, description: p.description || null, trigger_type: p.triggerType, conditions: p.conditions, actions: p.actions, is_active: false, created_by: ctx.userId }).select("id").single();
    if (error) {
      if (error.code === "23505") throw new Error("An automation with that code already exists.");
      throw new Error(error.message);
    }
    id = data.id;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "automation.created", entityType: "automation", entityId: data.id, after: { code: p.code, trigger: p.triggerType } });
    revalidatePath("/staff/crm/automations");
  });
  if (result.ok && id) redirect(`/staff/crm/automations/${id}`);
  return result;
}

export async function updateAutomation(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const { automationId } = z.object({ automationId: z.guid() }).parse(Object.fromEntries(formData));
    const p = parse(formData);
    const { error } = await ctx.supabase.from("automations").update({ name: p.name, description: p.description || null, trigger_type: p.triggerType, conditions: p.conditions, actions: p.actions }).eq("id", automationId);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "automation.updated", entityType: "automation", entityId: automationId, after: { trigger: p.triggerType, actions: p.actions } });
    revalidatePath(`/staff/crm/automations/${automationId}`);
    revalidatePath("/staff/crm/automations");
  });
}

export async function toggleAutomation(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ automationId: z.guid(), active: z.enum(["on", "off"]) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("automations").update({ is_active: p.active === "on" }).eq("id", p.automationId);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: p.active === "on" ? "automation.enabled" : "automation.disabled", entityType: "automation", entityId: p.automationId });
    revalidatePath(`/staff/crm/automations/${p.automationId}`);
    revalidatePath("/staff/crm/automations");
  });
}
