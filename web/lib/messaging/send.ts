import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { buildVariables, linkTtlDays, offerExtras, paymentExtras, type EmailExtras, type EmailLinks, type LinkPurpose } from "@/lib/email/send";
import { renderPreview, sanitiseParam } from "@/lib/messaging/meta-payload";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { getSettings } from "@/lib/settings";
import { mintToken } from "@/lib/tokens";
import type { MessageTemplateRow } from "@/lib/supabase/types";

/**
 * Sends the WhatsApp companion of one email moment, and records it.
 *
 * The variables are rebuilt with the same `buildVariables` the email used,
 * from the same offer, request and payment, so the two channels can never
 * say different things. The template row maps our variable names onto the
 * Meta template's positional parameters; the button, when the template has
 * one, carries a magic link minted here with the same purpose and life as
 * the email's.
 *
 * A send that cannot happen — the switch is off, the parent did not opt
 * in, the template is not active — is recorded as `skipped` with the
 * reason, so the Messages tab shows why nothing went rather than nothing.
 */

export type SendCompanionOptions = {
  applicationId: string;
  templateKey: string;
  idempotencyKey: string;
  emailMessageId?: string | null;
  offerId?: string | null;
  paymentRequestId?: string | null;
  paymentId?: string | null;
  missingDocuments?: string | null;
  /** Who asked: the job drain after an email, or a member of staff by hand. */
  trigger: "companion" | "manual";
};

export type SendCompanionResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; retryable: boolean };

export async function sendCompanionMessage(admin: AdminClient, opts: SendCompanionOptions): Promise<SendCompanionResult> {
  const graph = await loadApplicationGraph(admin, opts.applicationId);
  if (!graph) return { status: "skipped", reason: "application missing" };

  const settings = await getSettings(admin);
  const { data: template, error: tErr } = await admin.from("message_templates").select("*").eq("key", opts.templateKey).maybeSingle();
  if (tErr) return { status: "failed", error: tErr.message, retryable: true };

  const skip = async (reason: string): Promise<SendCompanionResult> => {
    // Recorded, not silent: staff can see the moment passed and why.
    await admin.from("messages").upsert(
      {
        application_id: graph.application.id,
        contact_id: graph.contact.id,
        direction: "out",
        template_key: opts.templateKey,
        to_normalised: graph.contact.mobile_normalised,
        provider: "none",
        status: "skipped",
        rendered_text: "",
        error: reason,
        idempotency_key: opts.idempotencyKey,
        email_message_id: opts.emailMessageId ?? null,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );
    return { status: "skipped", reason };
  };

  if (!settings.whatsappEnabled && opts.trigger === "companion") return skip("WhatsApp is switched off");
  if (!template || !template.is_active || !template.meta_template_name) return skip(`no active message template for "${opts.templateKey}"`);
  if (!graph.contact.whatsapp_opt_in) return skip("the parent has not opted in to WhatsApp");
  if (!graph.contact.mobile_normalised) return skip("the parent's mobile number could not be normalised");

  const offer = await offerExtras(admin, opts.offerId);
  const pay = await paymentExtras(admin, graph, opts.paymentRequestId, opts.paymentId);
  const extras: EmailExtras & { expiresAt: Date | null } = { ...offer, ...pay, missingDocuments: opts.missingDocuments ?? null };

  const links: EmailLinks = { nextStep: "" };
  let buttonSuffix: string | null = null;
  if (template.button_link) {
    const purpose = template.link_purpose;
    const minted = await mintToken(admin, {
      applicationId: graph.application.id,
      purpose,
      ttlDays: linkTtlDays(purpose, { expiresAt: extras.expiresAt, dueAt: pay.dueAt }, settings.nextStepTokenDays),
      maxUses: null,
      reason: `whatsapp:${opts.templateKey}`,
    });
    buttonSuffix = minted.token;
    if (purpose === "next_step") links.nextStep = minted.url;
    else links[purpose as LinkPurpose] = minted.url;
  }

  const vars = buildVariables(graph, links, extras);
  const params = template.parameters.map((name) => {
    const v = vars[name];
    return sanitiseParam(v === null || v === undefined ? "" : String(v));
  });
  const rendered = renderPreview(template.body_preview, params) + (buttonSuffix ? ` [${template.link_purpose} link]` : "");

  const provider = await getMessagingProvider();
  const { data: message, error: mErr } = await admin
    .from("messages")
    .upsert(
      {
        application_id: graph.application.id,
        contact_id: graph.contact.id,
        direction: "out",
        template_key: template.key,
        to_normalised: graph.contact.mobile_normalised,
        provider: provider.name,
        status: "queued",
        rendered_text: rendered,
        idempotency_key: opts.idempotencyKey,
        email_message_id: opts.emailMessageId ?? null,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    )
    .select("id, status")
    .maybeSingle();
  if (mErr) return { status: "failed", error: mErr.message, retryable: true };
  if (!message) {
    // The key already existed: an earlier attempt got this far. Never send twice.
    return { status: "skipped", reason: "already sent" };
  }

  const result = await provider.sendTemplate({
    to: graph.contact.mobile_normalised,
    templateName: template.meta_template_name,
    language: template.language,
    bodyParams: params,
    buttonUrlSuffix: buttonSuffix,
    idempotencyKey: opts.idempotencyKey,
  });

  if (!result.ok) {
    await admin.from("messages").update({ status: "failed", error: result.error }).eq("id", message.id);
    return { status: "failed", error: result.error, retryable: result.retryable };
  }

  await admin
    .from("messages")
    .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() })
    .eq("id", message.id);
  await admin.from("application_events").insert({
    application_id: graph.application.id,
    type: "message.sent",
    actor_type: "system",
    summary: `WhatsApp sent: ${template.name}`,
    payload: { message_id: message.id, template_key: template.key },
  });
  return { status: "sent", messageId: message.id };
}

/** The message template rows staff may choose from when sending by hand. */
export function activeTemplates(rows: MessageTemplateRow[]): MessageTemplateRow[] {
  return rows.filter((r) => r.is_active && r.meta_template_name);
}
