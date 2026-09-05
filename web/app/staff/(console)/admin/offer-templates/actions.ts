"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { validateTemplate } from "@/lib/email/render";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  bodyHtml: z.string().min(1).max(60_000),
  termsHtml: z.string().min(1).max(60_000),
});

/** Same shape as publishing an email template: validate against the allow-list, then a new version. */
export async function publishOfferTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const p = schema.parse(Object.fromEntries(formData));
    const { data: current } = await ctx.supabase
      .from("offer_templates")
      .select("allowed_variables")
      .eq("key", p.key)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!current) throw new Error("Unknown template key.");
    const problems = [...validateTemplate(p.bodyHtml, current.allowed_variables), ...validateTemplate(p.termsHtml, current.allowed_variables)];
    if (problems.length) {
      const names = problems.map((x) => (x.kind === "unknown_variable" ? `{{${x.name}}}` : "an unclosed {{#if}}"));
      throw new Error(`Cannot publish: ${[...new Set(names)].join(", ")}. Allowed: ${current.allowed_variables.map((v) => `{{${v}}}`).join(" ")}`);
    }
    const { error } = await ctx.supabase.rpc("publish_offer_template", {
      p_key: p.key,
      p_name: p.name,
      p_description: p.description || null,
      p_body_html: p.bodyHtml,
      p_terms_html: p.termsHtml,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/offer-templates");
    revalidatePath(`/staff/admin/offer-templates/${p.key}`);
  });
}
