"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { recordCrmAudit } from "@/lib/crm/audit";
import { validateRules } from "@/lib/crm/segments";
import { countSegment } from "@/lib/crm/segments-server";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

const schema = z.object({
  name: z.string().trim().min(1, "Give the segment a name.").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  campusId: z.string().optional().or(z.literal("")),
  rules: z.string(),
});

function parse(formData: FormData) {
  const p = schema.parse(Object.fromEntries(formData));
  let raw: unknown;
  try {
    raw = JSON.parse(p.rules);
  } catch {
    throw new Error("The rules could not be read.");
  }
  const v = validateRules(raw);
  if (!v.ok) throw new Error(v.problems.map((x) => x.message).join(" "));
  if (v.rules.length === 0) throw new Error("Add at least one rule.");
  return { ...p, rules: v.rules };
}

export async function createSegment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let id: string | null = null;
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const p = parse(formData);
    const count = await countSegment(ctx.supabase, p.rules, p.campusId || null);
    const { data, error } = await ctx.supabase
      .from("segments")
      .insert({ name: p.name, description: p.description || null, campus_id: p.campusId || null, rules: p.rules as unknown as Json, match_count: count, counted_at: new Date().toISOString(), created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "segment.created", entityType: "segment", entityId: data.id, after: { name: p.name, rules: p.rules as unknown as Json, matched: count } });
    revalidatePath("/staff/crm/segments");
  });
  if (result.ok && id) redirect(`/staff/crm/segments/${id}`);
  return result;
}

export async function updateSegment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const { segmentId } = z.object({ segmentId: z.guid() }).parse(Object.fromEntries(formData));
    const p = parse(formData);
    const count = await countSegment(ctx.supabase, p.rules, p.campusId || null);
    const { error } = await ctx.supabase
      .from("segments")
      .update({ name: p.name, description: p.description || null, campus_id: p.campusId || null, rules: p.rules as unknown as Json, match_count: count, counted_at: new Date().toISOString() })
      .eq("id", segmentId);
    if (error) throw new Error(error.message);
    await recordCrmAudit(createAdminClient(), ctx.actor, { action: "segment.updated", entityType: "segment", entityId: segmentId, after: { name: p.name, rules: p.rules as unknown as Json, matched: count } });
    revalidatePath(`/staff/crm/segments/${segmentId}`);
    revalidatePath("/staff/crm/segments");
  });
}

/** Today's answer. The stored count is a cache with a timestamp, never the truth. */
export async function recountSegment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.read");
    const { segmentId } = z.object({ segmentId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: seg } = await ctx.supabase.from("segments").select("*").eq("id", segmentId).maybeSingle();
    if (!seg) throw new Error("That segment is not one you can see.");
    const v = validateRules(seg.rules);
    if (!v.ok) throw new Error("This segment's rules are no longer valid; edit it.");
    const count = await countSegment(ctx.supabase, v.rules, seg.campus_id);
    // Written under the service role: reading a segment does not confer
    // editing it, and a count is a fact about today, not an edit.
    await createAdminClient().from("segments").update({ match_count: count, counted_at: new Date().toISOString() }).eq("id", segmentId);
    revalidatePath(`/staff/crm/segments/${segmentId}`);
    revalidatePath("/staff/crm/segments");
  });
}

export async function deleteSegment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const result = await guarded(async () => {
    const ctx = await requireStaffAction("crm.campaigns.write");
    const { segmentId } = z.object({ segmentId: z.guid() }).parse(Object.fromEntries(formData));
    const { data, error } = await ctx.supabase.from("segments").delete().eq("id", segmentId).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("That segment could not be deleted: a campaign names it, or it is not yours to delete.");
    revalidatePath("/staff/crm/segments");
  });
  if (result.ok) redirect("/staff/crm/segments");
  return result;
}
