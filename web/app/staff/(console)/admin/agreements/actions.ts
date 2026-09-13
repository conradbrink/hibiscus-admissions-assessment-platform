"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, "Key: lower-case letters, digits and underscores."),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  bodyHtml: z.string().min(1).max(60_000),
  required: z.string().optional(),
  documentUrl: z.union([z.literal(""), z.string().trim().regex(/^(https:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)$/, "The link must start with https:// or be a path on this site such as /policies/2026/Fees-Policy.pdf").max(500)]).optional(),
});

/** A new version of an existing agreement, or a brand-new one. Versions already accepted stay as they were. */
export async function publishAgreement(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const p = schema.parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.rpc("publish_agreement_template", {
      p_key: p.key,
      p_name: p.name,
      p_description: p.description || null,
      p_body_html: p.bodyHtml,
      p_required: p.required === "1",
      p_document_url: p.documentUrl || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/agreements");
    revalidatePath(`/staff/admin/agreements/${p.key}`);
  });
}

const scopeSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  gradeSortMin: z.union([z.literal(""), z.coerce.number().int().min(0).max(1000)]).optional(),
  gradeSortMax: z.union([z.literal(""), z.coerce.number().int().min(0).max(1000)]).optional(),
  mayDecline: z.string().optional(),
});

/**
 * Who is asked for an agreement, and whether they may say no.
 *
 * Separate from publishing on purpose. Publishing mints a new version, because
 * the wording a family signed has to stay exactly as they saw it. Deciding
 * that pre-school families are not asked for the learner code of conduct is
 * not a change to anybody's wording, and minting a version over it would leave
 * a trail of identical documents and make the signed record harder to read.
 *
 * So this edits the live version in place, and `publish_agreement_template`
 * carries these three forward to the next version rather than dropping them —
 * which is case 62 of the security suite.
 */
export async function updateAgreementScope(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const p = scopeSchema.parse(Object.fromEntries(formData));
    const min = p.gradeSortMin === "" || p.gradeSortMin === undefined ? null : p.gradeSortMin;
    const max = p.gradeSortMax === "" || p.gradeSortMax === undefined ? null : p.gradeSortMax;
    if (min !== null && max !== null && min > max) {
      throw new Error("The lowest grade cannot be above the highest: nobody would be asked for this agreement.");
    }
    const { error } = await ctx.supabase
      .from("agreement_templates")
      .update({ grade_sort_min: min, grade_sort_max: max, may_decline: p.mayDecline === "1", updated_at: new Date().toISOString() })
      .eq("key", p.key)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/agreements");
    revalidatePath(`/staff/admin/agreements/${p.key}`);
  });
}

/** Retiring an agreement: no active version, so nobody is asked to sign it. */
export async function retireAgreement(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const key = z.string().regex(/^[a-z0-9_]+$/).parse(formData.get("key"));
    const { error } = await ctx.supabase.from("agreement_templates").update({ is_active: false }).eq("key", key).eq("is_active", true);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/agreements");
  });
}
