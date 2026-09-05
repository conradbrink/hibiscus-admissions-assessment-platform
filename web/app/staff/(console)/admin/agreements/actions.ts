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
    });
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
