import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { wrapHtml } from "@/lib/email/layout";
import { getEmailProvider, type OutboundEmail } from "@/lib/email/provider";
import { renderHtml, renderSubject, renderText, type TemplateVariables } from "@/lib/email/render";
import { redactLinks } from "@/lib/email/redact";

/**
 * Sends one HR email from the active version of a template.
 *
 * Called only from the job drain, which gives it an idempotency key: a job
 * that runs twice sends once (the provider is told the key, and a message row
 * already marked sent for it short-circuits). Every message is recorded in
 * `hr_email_messages` whatever the provider, which is how the dev adapter
 * makes the whole journey walkable without a mailbox.
 */
export type SendTemplateInput = {
  key: string;
  to: string;
  vars: TemplateVariables;
  applicationId?: string | null;
  referenceRequestId?: string | null;
  employeeId?: string | null;
  attachments?: OutboundEmail["attachments"];
  idempotencyKey: string;
};

export type SendOutcome = { ok: true; messageId: string } | { ok: false; error: string; retryable: boolean };

export async function sendTemplate(admin: AdminClient, input: SendTemplateInput): Promise<SendOutcome> {
  const { data: template, error } = await admin
    .from("hr_email_templates")
    .select("*")
    .eq("key", input.key)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { ok: false, error: error.message, retryable: true };
  if (!template) return { ok: false, error: `No active HR template "${input.key}"`, retryable: false };

  let subject: string;
  let html: string;
  let text: string;
  try {
    subject = renderSubject(template.subject, input.vars, template.allowed_variables);
    html = wrapHtml(renderHtml(template.body_html, input.vars, template.allowed_variables), { preheader: subject });
    text = renderText(template.body_text, input.vars, template.allowed_variables);
  } catch (e) {
    return { ok: false, error: (e as Error).message, retryable: false };
  }

  const provider = await getEmailProvider();
  const { data: row, error: insertError } = await admin
    .from("hr_email_messages")
    .insert({
      hr_application_id: input.applicationId ?? null,
      hr_reference_request_id: input.referenceRequestId ?? null,
      hr_employee_id: input.employeeId ?? null,
      template_key: template.key,
      template_version: template.version,
      to_email: input.to,
      subject,
      // The dev adapter delivers nothing, so on a developer's machine the
      // stored copy keeps its links: that is how the journey is walked.
      body_html: provider.name === "dev" ? html : redactLinks(html),
      body_text: provider.name === "dev" ? text : redactLinks(text),
      provider: provider.name,
      status: "queued",
    })
    .select("id")
    .single();
  if (insertError || !row) return { ok: false, error: insertError?.message ?? "Could not record the email", retryable: true };

  const sent = await provider.send({
    to: input.to,
    subject,
    html,
    text,
    idempotencyKey: input.idempotencyKey,
    attachments: input.attachments,
  });
  if (!sent.ok) {
    await admin.from("hr_email_messages").update({ status: "failed", error: sent.error }).eq("id", row.id);
    return { ok: false, error: sent.error, retryable: sent.retryable };
  }
  await admin
    .from("hr_email_messages")
    .update({ status: "sent", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString() })
    .eq("id", row.id);
  return { ok: true, messageId: row.id };
}
