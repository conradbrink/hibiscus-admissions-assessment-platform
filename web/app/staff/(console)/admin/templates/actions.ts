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
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().min(1).max(50_000),
});

/** Validates against the key's allow-list, then publishes a new version atomically. */
export async function publishTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const p = schema.parse(Object.fromEntries(formData));

    const { data: current } = await ctx.supabase
      .from("email_templates")
      .select("allowed_variables")
      .eq("key", p.key)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!current) throw new Error("Unknown template key.");

    const problems = [
      ...validateTemplate(p.subject, current.allowed_variables),
      ...validateTemplate(p.bodyHtml, current.allowed_variables),
      ...validateTemplate(p.bodyText, current.allowed_variables),
    ];
    if (problems.length) {
      const names = problems.map((x) => (x.kind === "unknown_variable" ? `{{${x.name}}}` : "an unclosed {{#if}}"));
      throw new Error(`Cannot publish: ${[...new Set(names)].join(", ")}. Allowed: ${current.allowed_variables.map((v) => `{{${v}}}`).join(" ")}`);
    }

    const { error } = await ctx.supabase.rpc("publish_email_template", {
      p_key: p.key,
      p_name: p.name,
      p_description: p.description || null,
      p_subject: p.subject,
      p_body_html: p.bodyHtml,
      p_body_text: p.bodyText,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/templates");
    revalidatePath(`/staff/admin/templates/${p.key}`);
  });
}
