import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph, type ApplicationGraph } from "@/lib/applications";
import { buildIcs } from "@/lib/email/ics";
import { wrapHtml } from "@/lib/email/layout";
import { getEmailProvider } from "@/lib/email/provider";
import { renderHtml, renderSubject, renderText, type TemplateVariables } from "@/lib/email/render";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { mintToken } from "@/lib/tokens";

/**
 * Sends one templated email to the parent on an application, and records it.
 *
 * Called by the job drain, never directly by a request: every send is a job
 * with an idempotency key and, usually, a precondition. That is what makes
 * "a reminder for a cancelled booking" impossible and "the same confirmation
 * twice after a retry" impossible.
 */

export type SendTemplatedResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string; retryable: boolean }
  | { status: "skipped"; reason: string };

/** The variables every template may draw on, built from the application graph. */
export function buildVariables(graph: ApplicationGraph, nextStepLink: string): TemplateVariables {
  const { application, contact, campus, grade, booking } = graph;
  return {
    parent_first_name: contact.first_name,
    parent_last_name: contact.last_name,
    student_first_name: application.child_first_name,
    student_last_name: application.child_last_name,
    campus: campus.name,
    grade: grade.name,
    application_reference: application.reference,
    next_step_link: nextStepLink,
    location: booking?.session.location ?? null,
    assessment_date: booking ? formatDateLong(booking.session.starts_at) : null,
    assessment_time: booking ? formatTime(booking.session.starts_at) : null,
    // Later phases populate these; listing them now means a template that
    // references one renders empty rather than failing validation.
    offer_expiry_date: null,
    amount_due: null,
    payment_link: null,
    results_link: null,
    offer_link: null,
  };
}

export async function sendTemplatedEmail(
  admin: AdminClient,
  opts: { applicationId: string; templateKey: string; idempotencyKey: string; bookingId?: string | null }
): Promise<SendTemplatedResult> {
  const graph = await loadApplicationGraph(admin, opts.applicationId);
  if (!graph) return { status: "skipped", reason: "application missing" };

  const { data: template, error: tErr } = await admin
    .from("email_templates")
    .select("*")
    .eq("key", opts.templateKey)
    .eq("is_active", true)
    .maybeSingle();
  if (tErr) return { status: "failed", error: tErr.message, retryable: true };
  if (!template) {
    // A missing template is a configuration error, not a transient one.
    return { status: "failed", error: `No active template for "${opts.templateKey}"`, retryable: false };
  }

  const settings = await getSettings(admin);
  const link = await mintToken(admin, {
    applicationId: graph.application.id,
    purpose: "next_step",
    ttlDays: settings.nextStepTokenDays,
    reason: `email:${opts.templateKey}`,
  });

  const vars = buildVariables(graph, link.url);
  let subject: string;
  let html: string;
  let text: string;
  try {
    subject = renderSubject(template.subject, vars, template.allowed_variables);
    html = wrapHtml(renderHtml(template.body_html, vars, template.allowed_variables));
    text = renderText(template.body_text, vars, template.allowed_variables);
  } catch (e) {
    return { status: "failed", error: (e as Error).message, retryable: false };
  }

  const attachments: Array<{ filename: string; content: string; contentType: string }> = [];
  if (
    (opts.templateKey === "booking_confirmed" || opts.templateKey === "visit_confirmed") &&
    graph.booking
  ) {
    const s = graph.booking.session;
    attachments.push({
      filename: "hibiscus-booking.ics",
      contentType: "text/calendar",
      content: buildIcs({
        uid: graph.booking.id,
        summary:
          s.kind === "assessment"
            ? `${graph.application.child_first_name} — Hibiscus assessment`
            : `Hibiscus Schools visit — ${graph.campus.name}`,
        description: `Reference ${graph.application.reference}`,
        location: [graph.campus.name, s.location].filter(Boolean).join(", "),
        startsAt: new Date(s.starts_at),
        endsAt: new Date(s.ends_at),
      }),
    });
  }

  const provider = await getEmailProvider();

  const { data: message, error: mErr } = await admin
    .from("email_messages")
    .insert({
      application_id: graph.application.id,
      contact_id: graph.contact.id,
      template_key: template.key,
      template_version: template.version,
      to_email: graph.contact.email,
      subject,
      body_html: html,
      body_text: text,
      provider: provider.name,
      status: "queued",
    })
    .select("id")
    .single();
  if (mErr || !message) return { status: "failed", error: mErr?.message ?? "insert failed", retryable: true };

  const result = await provider.send({
    to: graph.contact.email,
    subject,
    html,
    text,
    idempotencyKey: opts.idempotencyKey,
    attachments,
  });

  if (!result.ok) {
    await admin
      .from("email_messages")
      .update({ status: "failed", error: result.error })
      .eq("id", message.id);
    return { status: "failed", error: result.error, retryable: result.retryable };
  }

  await admin
    .from("email_messages")
    .update({
      status: "sent",
      provider_message_id: result.providerMessageId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", message.id);

  await admin.from("application_events").insert({
    application_id: graph.application.id,
    type: "email.sent",
    actor_type: "system",
    summary: `Email sent: ${template.name}`,
    payload: { email_message_id: message.id, template_key: template.key, subject },
  });

  return { status: "sent", messageId: message.id };
}
