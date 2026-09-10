import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { loadApplicationGraph, type ApplicationGraph } from "@/lib/applications";
import { buildIcs } from "@/lib/email/ics";
import { wrapHtml } from "@/lib/email/layout";
import { getEmailProvider } from "@/lib/email/provider";
import { renderHtml, renderSubject, renderText, type TemplateVariables } from "@/lib/email/render";
import { paymentReferenceFor } from "@/lib/payments/reference";
import { formatDateLong, formatTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { mintToken, siteUrl } from "@/lib/tokens";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { ReceiptDocument } from "@/lib/documents/receipt-pdf";
import { loadBankInstructions, requestLines } from "@/lib/payments/requests";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { promotionLines, type PromotionFeeSnapshot } from "@/lib/promotions/apply";

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

export type LinkPurpose = "results" | "offer" | "payment" | "registration";

export type EmailLinks = {
  nextStep: string;
  results?: string | null;
  offer?: string | null;
  payment?: string | null;
  registration?: string | null;
};

/** Values that come from the live offer, payment request and payment. */
export type EmailExtras = {
  offerExpiryDate?: string | null;
  amountDue?: string | null;
  paymentDueDate?: string | null;
  bankDetails?: string | null;
  amountPaid?: string | null;
  paymentReference?: string | null;
  paymentDate?: string | null;
  missingDocuments?: string | null;
  mismatchDetails?: string | null;
  /** "Application fee waived · P1,000 uniform voucher", from the offer's frozen deal. */
  promotionText?: string | null;
  /** After a registration submission: what is still outstanding, or "yes" in `allReceived` when nothing is. */
  outstandingItems?: string | null;
  allReceived?: boolean;
};

/** The deal's one-line description from an offer's fee snapshot, or null. */
export function promotionTextFrom(fees: unknown): string | null {
  const applied = (feeSnapshotFrom(fees) as PromotionFeeSnapshot | null)?.promotion ?? null;
  if (!applied) return null;
  const text = promotionLines(applied);
  return text || null;
}

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
    // The campus's own lines: street address, then its phone numbers. Where
    // the child sits, for a parent who has only the link.
    campus_address: campus.address ?? null,
    assessment_date: booking ? formatDateLong(booking.session.starts_at) : null,
    assessment_time: booking ? formatTime(booking.session.starts_at) : null,
    // What to call the appointment. A parent who booked a look around the
    // campus should not be told their assessment is confirmed, and the two
    // moments share one template, so the noun is a variable rather than a
    // second template (and a second Meta approval) per moment.
    // Never null: the nudge to rebook is sent precisely when there is no
    // booking left, and an empty noun would read "choose a new  time".
    booking_kind: booking
      ? booking.kind === "assessment"
        ? "assessment"
        : "visit"
      : application.requires_assessment
        ? "assessment"
        : "visit",
    // Null renders as empty and satisfies an {{#if}}, so a template that
    // references a link its send did not mint simply omits it.
    results_link: links.results ?? null,
    offer_link: links.offer ?? null,
    payment_link: links.payment ?? null,
    registration_link: links.registration ?? null,
    offer_expiry_date: extras.offerExpiryDate ?? null,
    amount_due: extras.amountDue ?? null,
    payment_due_date: extras.paymentDueDate ?? null,
    bank_details: extras.bankDetails ?? null,
    amount_paid: extras.amountPaid ?? null,
    payment_reference: extras.paymentReference ?? null,
    payment_date: extras.paymentDate ?? null,
    missing_documents: extras.missingDocuments ?? null,
    mismatch_details: extras.mismatchDetails ?? null,
    promotion_text: extras.promotionText ?? null,
    outstanding_items: extras.outstandingItems ?? null,
    all_received: extras.allReceived ? "yes" : null,
    start_date: formatDateLong(graph.intake.starts_on),
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
  /** The payment request, for the amount due, due date and bank details. */
  paymentRequestId?: string | null;
  /** The payment a receipt is about. */
  paymentId?: string | null;
  /** Free text for the documents-missing emails. */
  missingDocuments?: string | null;
  /** Free text for the document-mismatch email. */
  mismatchDetails?: string | null;
  outstandingItems?: string | null;
  allReceived?: boolean;
};

/**
 * Offer-derived variables. Looked up here rather than through the graph so
 * the graph stays the parent journey's shape; the offer tables arrive with
 * a later migration and this stays a no-op until then.
 */
export async function offerExtras(admin: AdminClient, offerId: string | null | undefined): Promise<EmailExtras & { expiresAt: Date | null }> {
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
    promotionText: promotionTextFrom(data.fees),
  };
}

/**
 * What the payment emails say about money: the request's amount and due
 * date (which take precedence over the offer's provisional figure), the
 * bank details for the campus and currency, and for a receipt the payment.
 */
export async function paymentExtras(
  admin: AdminClient,
  graph: ApplicationGraph,
  requestId: string | null | undefined,
  paymentId: string | null | undefined
): Promise<EmailExtras & { dueAt: Date | null; receipt: ReceiptAttachment | null }> {
  if (!requestId && !paymentId) return { dueAt: null, receipt: null };
  const out: EmailExtras & { dueAt: Date | null; receipt: ReceiptAttachment | null } = { dueAt: null, receipt: null };
  const { data: payment } = paymentId ? await admin.from("payments").select("*").eq("id", paymentId).maybeSingle() : { data: null };
  const reqId = requestId ?? payment?.payment_request_id ?? null;
  const { data: request } = reqId ? await admin.from("payment_requests").select("*").eq("id", reqId).maybeSingle() : { data: null };
  if (request) {
    out.dueAt = new Date(request.due_at);
    out.paymentDueDate = formatDateLong(request.due_at);
    const { data: offerRow } = await admin.from("offers").select("fees").eq("id", request.offer_id).maybeSingle();
    out.promotionText = promotionTextFrom(offerRow?.fees);
    out.amountDue = formatMoney(Number(request.amount_minor) - Number(request.paid_minor), request.currency);
    const bank = await loadBankInstructions(admin, { currency: request.currency, campusId: graph.application.campus_id });
    out.bankDetails = bank?.body_text ?? null;
  }
  if (payment && payment.status === "succeeded") {
    out.amountPaid = formatMoney(Number(payment.amount_minor), payment.currency);
    // The child's name, which is what the family used and what they will
    // recognise. The gateway's own reference stays on the payment row for
    // the finance console.
    out.paymentReference = paymentReferenceFor(graph.application.child_first_name, graph.application.child_last_name);
    out.paymentDate = formatDateLong(payment.received_on ?? payment.updated_at);
    out.receipt = {
      receiptNumber: `R-${payment.id.slice(0, 8).toUpperCase()}`,
      currency: payment.currency,
      lines: request ? requestLines(request) : [],
      amountMinor: Number(payment.amount_minor),
      method: payment.method,
      providerLabel: payment.provider === "dpo" ? "DPO Pay" : payment.provider === "paygate" ? "PayGate" : payment.provider === "none" ? "" : payment.provider,
      paymentReference: out.paymentReference,
      approvalCode: payment.approval_code,
      paidOn: out.paymentDate,
    };
  }
  return out;
}

/**
 * How long a purpose-specific link lives. An offer link must outlive the
 * offer by a margin, so a parent opening the email on the last day is not
 * told the link has expired; a payment link outlives the due date, because
 * paying late is still paying. Shared with the WhatsApp companion so both
 * channels' links expire together.
 */
export function linkTtlDays(
  purpose: LinkPurpose | "next_step",
  bounds: { expiresAt: Date | null; dueAt: Date | null },
  nextStepTokenDays: number
): number {
  const outlive = (until: Date | null) => (until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 86_400_000) + 7) : nextStepTokenDays);
  if (purpose === "offer") return outlive(bounds.expiresAt);
  if (purpose === "payment") return Math.max(outlive(bounds.dueAt), nextStepTokenDays);
  return nextStepTokenDays;
}

type ReceiptAttachment = {
  receiptNumber: string;
  currency: string;
  lines: Array<{ label: string; amount_minor: number }>;
  amountMinor: number;
  method: "online" | "eft" | "waived" | "none";
  providerLabel: string;
  paymentReference: string;
  approvalCode: string | null;
  paidOn: string;
};

// ---------------------------------------------------------------------------
// The half of a send that does not care whose email it is
// ---------------------------------------------------------------------------

/**
 * Finding the template, rendering it, handing it to the provider and
 * recording the row are the same work whether the email is about an
 * application or a member of staff. Only who it is *about* differs, so that
 * is the parameter and the rest is shared.
 *
 * Deliberately two functions rather than one: the caller still decides what
 * happens between finding the template and rendering it. The parent path
 * mints magic links there, and minting them for a template that does not
 * exist would leave live tokens behind for an email that was never sent.
 */

type EmailTemplateRow = Database["public"]["Tables"]["email_templates"]["Row"];

type TemplateLookup =
  | { ok: true; template: EmailTemplateRow }
  | { ok: false; result: SendTemplatedResult };

async function loadActiveTemplate(admin: AdminClient, key: string, audience?: "parent" | "staff"): Promise<TemplateLookup> {
  const { data: template, error } = await admin
    .from("email_templates")
    .select("*")
    .eq("key", key)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { ok: false, result: { status: "failed", error: error.message, retryable: true } };
  // A missing template is a configuration error, not a transient one.
  if (!template) return { ok: false, result: { status: "failed", error: `No active template for "${key}"`, retryable: false } };
  if (audience && template.audience !== audience) {
    return { ok: false, result: { status: "failed", error: `Template "${key}" is not a ${audience} template`, retryable: false } };
  }
  return { ok: true, template };
}

/** Where the email goes, and which row of ours the address belongs to. */
type EmailRecipient = { email: string; contactId?: string | null; staffId?: string | null };

/** What the email is about, for the record. */
type EmailSubject = { applicationId?: string | null };

type EmailAttachment = { filename: string; content: string | Uint8Array; contentType: string };

type RenderAndSendOptions = {
  template: EmailTemplateRow;
  variables: TemplateVariables;
  recipient: EmailRecipient;
  subject?: EmailSubject;
  idempotencyKey: string;
  attachments?: EmailAttachment[];
};

/**
 * The rendered subject comes back beside the result because the caller
 * writes it into the timeline, and rendering it twice could disagree.
 */
type RenderAndSendOutcome = { result: SendTemplatedResult; renderedSubject: string | null };

async function renderAndSend(admin: AdminClient, opts: RenderAndSendOptions): Promise<RenderAndSendOutcome> {
  const { template } = opts;
  let subject: string;
  let html: string;
  let text: string;
  try {
    subject = renderSubject(template.subject, opts.variables, template.allowed_variables);
    html = wrapHtml(renderHtml(template.body_html, opts.variables, template.allowed_variables));
    text = renderText(template.body_text, opts.variables, template.allowed_variables);
  } catch (e) {
    return { result: { status: "failed", error: (e as Error).message, retryable: false }, renderedSubject: null };
  }

  const provider = await getEmailProvider();

  const { data: message, error: mErr } = await admin
    .from("email_messages")
    .insert({
      application_id: opts.subject?.applicationId ?? null,
      contact_id: opts.recipient.contactId ?? null,
      recipient_staff_id: opts.recipient.staffId ?? null,
      template_key: template.key,
      template_version: template.version,
      to_email: opts.recipient.email,
      subject,
      body_html: html,
      body_text: text,
      provider: provider.name,
      status: "queued",
    })
    .select("id")
    .single();
  if (mErr || !message) {
    return { result: { status: "failed", error: mErr?.message ?? "insert failed", retryable: true }, renderedSubject: subject };
  }

  const result = await provider.send({
    to: opts.recipient.email,
    subject,
    html,
    text,
    idempotencyKey: opts.idempotencyKey,
    attachments: opts.attachments,
  });

  if (!result.ok) {
    await admin
      .from("email_messages")
      .update({ status: "failed", error: result.error })
      .eq("id", message.id);
    return { result: { status: "failed", error: result.error, retryable: result.retryable }, renderedSubject: subject };
  }

  await admin
    .from("email_messages")
    .update({
      status: "sent",
      provider_message_id: result.providerMessageId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", message.id);

  return { result: { status: "sent", messageId: message.id }, renderedSubject: subject };
}

export async function sendTemplatedEmail(admin: AdminClient, opts: SendTemplatedOptions): Promise<SendTemplatedResult> {
  const graph = await loadApplicationGraph(admin, opts.applicationId);
  if (!graph) return { status: "skipped", reason: "application missing" };

  const lookup = await loadActiveTemplate(admin, opts.templateKey);
  if (!lookup.ok) return lookup.result;
  const template = lookup.template;

  const settings = await getSettings(admin);
  const offer = await offerExtras(admin, opts.offerId);
  const pay = await paymentExtras(admin, graph, opts.paymentRequestId, opts.paymentId);
  const extras: EmailExtras & { expiresAt: Date | null } = { ...offer, ...pay, missingDocuments: opts.missingDocuments ?? null, mismatchDetails: opts.mismatchDetails ?? null, outstandingItems: opts.outstandingItems ?? null, allReceived: opts.allReceived ?? false };
  const nextStep = await mintToken(admin, {
    applicationId: graph.application.id,
    purpose: "next_step",
    ttlDays: settings.nextStepTokenDays,
    reason: `email:${opts.templateKey}`,
  });
  const links: EmailLinks = { nextStep: nextStep.url };
  for (const purpose of opts.links ?? []) {
    const ttlDays = linkTtlDays(purpose, { expiresAt: extras.expiresAt, dueAt: pay.dueAt }, settings.nextStepTokenDays);
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

  const attachments: EmailAttachment[] = [];
  if (opts.templateKey === "payment_received" && pay.receipt) {
    const element = createElement(ReceiptDocument, {
      logoUrl: logoUrlFor(siteUrl()),
      letterhead: graph.campus,
      reference: graph.application.reference,
      studentName: `${graph.application.child_first_name} ${graph.application.child_last_name}`,
      payerName: `${graph.contact.first_name} ${graph.contact.last_name}`,
      campus: graph.campus.name,
      grade: graph.grade.name,
      ...pay.receipt,
    }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(element);
    attachments.push({ filename: `hibiscus-receipt-${pay.receipt.receiptNumber}.pdf`, contentType: "application/pdf", content: new Uint8Array(buffer) });
  }
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
            : `Hibiscus International Schools visit — ${graph.campus.name}`,
        description: `Reference ${graph.application.reference}`,
        location: [graph.campus.name, s.location, graph.campus.address?.split("\n")[0]].filter(Boolean).join(", "),
        startsAt: new Date(s.starts_at),
        endsAt: new Date(s.ends_at),
      }),
    });
  }

  const { result, renderedSubject } = await renderAndSend(admin, {
    template,
    variables: vars,
    recipient: { email: graph.contact.email, contactId: graph.contact.id },
    subject: { applicationId: graph.application.id },
    idempotencyKey: opts.idempotencyKey,
    attachments,
  });
  if (result.status !== "sent") return result;

  await admin.from("application_events").insert({
    application_id: graph.application.id,
    type: "email.sent",
    actor_type: "system",
    summary: `Email sent: ${template.name}`,
    payload: { email_message_id: result.messageId, template_key: template.key, subject: renderedSubject },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Staff email: a template with audience 'staff', no application, no tokens
// ---------------------------------------------------------------------------

export type SendStaffOptions = {
  staffId: string;
  templateKey: string;
  variables: Record<string, string>;
  idempotencyKey: string;
};

/**
 * Sends one templated email to a member of staff — the daily digest — and
 * records it against them. Same renderer, layout and provider as the
 * parent emails; no magic links, because staff sign in.
 */
export async function sendStaffEmail(admin: AdminClient, opts: SendStaffOptions): Promise<SendTemplatedResult> {
  const [{ data: staff }, lookup] = await Promise.all([
    admin.from("staff_profiles").select("id, full_name, email, is_active").eq("id", opts.staffId).maybeSingle(),
    loadActiveTemplate(admin, opts.templateKey, "staff"),
  ]);
  if (!lookup.ok) return lookup.result;
  if (!staff || !staff.is_active) return { status: "skipped", reason: "staff member missing or inactive" };

  const { result } = await renderAndSend(admin, {
    template: lookup.template,
    variables: opts.variables,
    recipient: { email: staff.email, staffId: staff.id },
    idempotencyKey: opts.idempotencyKey,
  });
  return result;
}
