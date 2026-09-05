"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { templateProblems } from "@/components/staff/message-template-editor";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(120),
  metaTemplateName: z.string().trim().max(120).optional(),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
  bodyPreview: z.string().min(1).max(2000),
  parameters: z.string().max(2000).optional(),
  buttonLink: z.literal("1").optional(),
  linkPurpose: z.enum(["next_step", "results", "offer", "payment", "registration"]).optional(),
  isActive: z.literal("1").optional(),
});

/**
 * Saves the mapping. The same checks the editor shows run here against the
 * email template's allow-list, so a variable that is not allowed in the
 * email cannot be sent by WhatsApp either. Through the staff client: RLS
 * requires templates.write.
 */
export async function saveMessageTemplate(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("templates.write");
    const p = schema.parse(Object.fromEntries(formData));
    const parameters = (p.parameters ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { data: email } = await ctx.supabase.from("email_templates").select("allowed_variables").eq("key", p.key).eq("is_active", true).maybeSingle();
    if (!email) throw new Error("There is no active email template with this key.");
    const problems = templateProblems({
      parameters,
      bodyPreview: p.bodyPreview,
      allowed: email.allowed_variables.filter((v) => !v.endsWith("_link")),
      metaName: p.metaTemplateName ?? "",
      active: p.isActive === "1",
    });
    if (problems.length) throw new Error(problems.join(" · "));

    const { error } = await ctx.supabase
      .from("message_templates")
      .update({
        name: p.name,
        meta_template_name: p.metaTemplateName || null,
        language: p.language,
        body_preview: p.bodyPreview,
        parameters,
        button_link: p.buttonLink === "1",
        link_purpose: p.buttonLink === "1" ? (p.linkPurpose ?? "next_step") : "next_step",
        is_active: p.isActive === "1",
        updated_by: ctx.userId,
      })
      .eq("key", p.key);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/message-templates");
    revalidatePath(`/staff/admin/message-templates/${p.key}`);
  });
}
