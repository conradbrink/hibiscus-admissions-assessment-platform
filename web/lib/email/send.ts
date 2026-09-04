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
 *
 * Links are minted *here*, at send time, never earlier: a raw token exists in
 * the email and nowhere else. The job payload names which purposes the
 * template needs (`links: ["results", "offer"]`) and this function mints them.
 */

export type SendTemplatedResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string; retryable: boolean }
  | { status: "skipped"; reason: string };

export type LinkPurpose = "results" | "offer";

export type EmailLinks = {
  nextStep: string;
  results?: string | null;
  offer?: string | null;
};

/** Values that come from the live offer. Empty until Phase 2's offers exist. */
export type EmailExtras = {
  offerExpiryDate?: string | null;
  amountDue?: string | null;
  paymentLink?: string | null;
};

/** The variables every template may draw on, built from the application graph. */
export function buildVariables(graph: ApplicationGraph, links: EmailLinks, extras: EmailExtras = {}): TemplateVariables {
  const { application, contact, campus, grade, booking } = graph;
  return {
    parent_first_name: contact.first_name,
    parent_last_name: contact.last_name,
    student_first_name: application.child_first_name,
    student_last_name: application.child_last_name,
    campus: campus.name,
    grade: grade.name,
    application_reference: application.reference,
    next_step_link: links.nextStep,
    location: booking?.session.location ?? null,
    assessment_date: booking ? formatDateLong(booking.session.starts_at) : null,
    assessment_time: booking ? formatTime(booking.session.starts_at) : null,
    // Null renders as empty and satisfies an {{#if}}, so a template that
    // references a link its send did not mint simply omits it.
    results_link: links.results ?? null,
    offer_link: links.offer ?? null,
    offer_expiry_date: extras.offerExpiryDate ?? null,
    amount_due: extras.amountDue ?? null,
    payment_link: extras.paymentLink ?? null,
  };
}

export type SendTemplatedOptions = {
  applicationId: string;
  templateKey: string;
  idempotencyKey: string;
  bookingId?: string | null;
  /** Which purpose-specific links to mint for this send. */
  links?: LinkPurpose[];
  /** The offer the email is about, for its expiry and amount. */
  offerId?: string | null;
};

/**
 * Offer-derived variables. Looked up here rather than through the graph so
 * the graph stays the parent journey's shape; the offer tables arrive with
 * a later migration and this stays a no-op until then.
 */
async function offerExtras(admin: AdminClient, offerId: string | null | undefined): Promise<EmailExtras & { expiresAt: Date | null }> {
  if (!offerId) return { expiresAt: null };
  const { data, error } = await admin
    .from("offers")
    .select("expires_at, fees, currency")
    .eq("id", offerId)
    .maybeSingle();
  if (error || !data) return { expiresAt: null };
  const fees = (data.fees as { total_minor?: number; payable_at_acceptance_minor?: number } | null) ?? null;
  const dueMinor = fees?.payable_at_acceptance_minor ?? null;
  return {
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    offerExpiryDate: data.expires_at ? formatDateLong(data.expires_at) : null,
    amountDue: dueMinor !== null ? formatMoney(dueMinor, data.currency) : null,
  };
}

export function formatMoney(minor: number, currency: string): string {
  const symbol = currency === "ZAR" ? "R" : "P";
  return `${symbol} ${(minor / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function sendTemplatedEmail(admin: AdminClient, opts: SendTemplatedOptions): Promise<SendTemplatedResult> {
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
  const extras = await offerExtras(admin, opts.offerId);
  const nextStep = await mintToken(admin, {
    applicationId: graph.application.id,
    purpose: "next_step",
    ttlDays: settings.nextStepTokenDays,
    reason: `email:${opts.templateKey}`,
  });
  const links: EmailLinks = { nextStep: nextStep.url };
  for (const purpose of opts.links ?? []) {
    // An offer link must outlive the offer by a margin, so a parent opening
    // the email on the last day is not told the link has expired.
    const ttlDays =
      purpose === "offer" && extras.expiresAt
        ? Math.max(1, Math.ceil((extras.expiresAt.getTime() - Date.now()) / 86_400_000) + 7)
        : settings.nextStepTokenDays;
    const minted = await mintToken(admin, {
      applicationId: graph.application.id,
      purpose,
      ttlDays,
      // Never single-use: a parent reads an offer more than once.
      maxUses: null,
      reason: `email:${opts.templateKey}`,
    });
    links[purpose] = minted.url;
  }

  const vars = buildVariables(graph, links, extras);
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
