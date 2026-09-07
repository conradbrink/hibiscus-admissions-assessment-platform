import "server-only";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { ApplicationGraph } from "@/lib/applications";
import { AgreementsDocument, signaturePathFrom } from "@/lib/documents/agreements-pdf";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { OfferDocument } from "@/lib/documents/offer-pdf";
import { ProfileDocument } from "@/lib/documents/profile-pdf";
import { ReceiptDocument } from "@/lib/documents/receipt-pdf";
import { RegistrationDocument, type Section } from "@/lib/documents/registration-pdf";
import { formatDateLong } from "@/lib/format-date";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { loadLatestPaymentRequest, requestLines } from "@/lib/payments/requests";
import { loadVisibleProfile } from "@/lib/profile/load";
import { applicableRequirements, liveDocument } from "@/lib/registration/completeness";
import { loadRegistrationBundle } from "@/lib/registration/load";
import { RELATIONSHIP_LABELS } from "@/lib/registration/schema";
import type { AdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";

/**
 * Every PDF the platform can produce for one applicant, rendered for a
 * member of staff from the stored records. The caller has already read the
 * application under RLS; this module only assembles and renders. The parent
 * routes render the same documents from their own session.
 */
export const STAFF_PDF_KINDS = ["offer", "receipt", "profile", "registration", "agreements"] as const;
export type StaffPdfKind = (typeof STAFF_PDF_KINDS)[number];

export const STAFF_PDF_LABELS: Record<StaffPdfKind, string> = {
  offer: "Offer letter",
  receipt: "Payment receipt",
  profile: "Learning profile",
  registration: "Registration record",
  agreements: "Signed agreements",
};

export type StaffPdf = { buffer: Buffer; filename: string } | { unavailable: string };

const render = async (element: unknown): Promise<Buffer> => renderToBuffer(element as ReactElement<DocumentProps>);
const nameOf = (g: ApplicationGraph) => `${g.application.child_first_name} ${g.application.child_last_name}`;

export async function renderStaffPdf(admin: AdminClient, graph: ApplicationGraph, kind: StaffPdfKind): Promise<StaffPdf> {
  const logoUrl = logoUrlFor(siteUrl());
  const ref = graph.application.reference;

  if (kind === "offer") {
    // The latest offer of any status but a plain draft, so a withdrawn or expired letter can still be produced for the file.
    const { data: offer } = await admin.from("offers").select("*").eq("application_id", graph.application.id).neq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!offer) return { unavailable: "No offer has been drafted for this applicant." };
    const fees = feeSnapshotFrom(offer.fees);
    const buffer = await render(
      createElement(OfferDocument, {
        logoUrl,
        letterhead: graph.campus,
        studentName: nameOf(graph),
        reference: ref,
        bodyHtml: offer.rendered_html,
        termsHtml: offer.terms_html,
        fees,
        bankDetails: typeof (offer.variables as { bank_details?: unknown })?.bank_details === "string" ? (offer.variables as { bank_details: string }).bank_details : null,
        expiresOn: offer.expires_at ? formatDateLong(offer.expires_at) : null,
        sentOn: offer.sent_at ? formatDateLong(offer.sent_at) : null,
        signatory: { name: graph.campus.head_name, title: graph.campus.head_title, imageDataUrl: graph.campus.signature_data_url },
      })
    );
    return { buffer, filename: `hibiscus-offer-${ref}.pdf` };
  }

  if (kind === "receipt") {
    const request = await loadLatestPaymentRequest(admin, graph.application.id);
    if (!request) return { unavailable: "No payment has been requested for this applicant." };
    const { data: payment } = await admin.from("payments").select("*").eq("payment_request_id", request.id).eq("status", "succeeded").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!payment) return { unavailable: "No successful payment has been recorded yet." };
    const reference = payment.method === "eft" ? (payment.bank_reference ?? payment.company_ref) : payment.company_ref;
    const buffer = await render(
      createElement(ReceiptDocument, {
        logoUrl,
        letterhead: graph.campus,
        reference: ref,
        receiptNumber: `R-${payment.id.slice(0, 8).toUpperCase()}`,
        studentName: nameOf(graph),
        payerName: `${graph.contact.first_name} ${graph.contact.last_name}`,
        campus: graph.campus.name,
        grade: graph.grade.name,
        currency: payment.currency,
        lines: requestLines(request),
        amountMinor: Number(payment.amount_minor),
        method: payment.method,
        providerLabel: payment.provider === "dpo" ? "DPO Pay" : payment.provider === "paygate" ? "PayGate" : payment.provider === "none" ? "" : payment.provider,
        paymentReference: reference,
        approvalCode: payment.approval_code,
        paidOn: formatDateLong(payment.received_on ?? payment.updated_at),
      })
    );
    return { buffer, filename: `hibiscus-receipt-${ref}.pdf` };
  }

  if (kind === "profile") {
    const visible = await loadVisibleProfile(admin, graph.application);
    if (!visible) return { unavailable: "The learning profile has not been published yet." };
    const buffer = await render(
      createElement(ProfileDocument, {
        logoUrl,
        letterhead: graph.campus,
        studentName: nameOf(graph),
        gradeName: graph.grade.name,
        campusName: graph.campus.name,
        reference: ref,
        generatedOn: formatDateLong(visible.profile.published_at ?? visible.profile.created_at),
        computed: visible.computed,
        narrative: visible.narrative,
      })
    );
    return { buffer, filename: `hibiscus-learning-profile-${ref}.pdf` };
  }

  const bundle = await loadRegistrationBundle(admin, graph);
  const r = bundle.registration;

  if (kind === "registration") {
    if (!r) return { unavailable: "Registration has not started for this applicant." };
    const guardians = bundle.contacts.filter((c) => c.kind !== "emergency");
    const emergency = bundle.contacts.filter((c) => c.kind === "emergency");
    const person = (c: (typeof bundle.contacts)[number]) => [
      { label: "Name", value: `${c.first_name} ${c.last_name}` },
      { label: "Relationship", value: RELATIONSHIP_LABELS[c.relationship] ?? c.relationship },
      { label: "Email", value: c.email },
      { label: "Mobile", value: c.mobile },
      { label: "Other phone", value: c.phone },
      { label: "Address", value: c.address },
      { label: "Nationality", value: c.nationality },
    ];
    const sections: Section[] = [
      {
        heading: "Student",
        fields: [
          { label: "Legal name", value: [r.legal_first_name, r.legal_middle_names, r.legal_last_name].filter(Boolean).join(" ") },
          { label: "Preferred name", value: r.preferred_name },
          { label: "Gender", value: r.gender },
          { label: "Date of birth", value: r.date_of_birth ? formatDateLong(r.date_of_birth) : null },
          { label: "Nationality", value: r.nationality },
          { label: "Country of birth", value: r.country_of_birth },
          { label: "Place of birth", value: r.place_of_birth },
          { label: "Language at home", value: r.home_language },
          { label: "Identity document", value: r.identity_type ? `${r.identity_type.replace(/_/g, " ")} · ${r.identity_number ?? ""}` : null },
          { label: "Previous school", value: r.previous_institution },
          { label: "Current grade", value: r.current_grade },
        ],
      },
      ...guardians.map((g, i) => ({ heading: i === 0 ? "Parents and guardians" : "", subheading: g.kind === "primary_guardian" ? "Primary parent or guardian" : "Second parent or guardian", fields: person(g) })),
      ...emergency.map((e, i) => ({ heading: i === 0 ? "Emergency contacts" : "", subheading: `Contact ${i + 1}`, fields: person(e) })),
      {
        heading: "Medical",
        fields: [
          { label: "Medical aid", value: r.medical_aid_name },
          { label: "Membership number", value: r.medical_aid_number },
          { label: "Principal member", value: r.medical_aid_principal_member },
          { label: "Emergency treatment", value: r.emergency_treatment_consent === null ? null : r.emergency_treatment_consent ? "The school may authorise treatment" : "Call the parent first" },
          { label: "Allergies", value: r.allergies },
          { label: "Medical conditions", value: r.medical_conditions },
          { label: "Regular medication", value: r.medication },
          { label: "Vaccinations", value: r.vaccination_notes },
          { label: "Other notes", value: r.medical_notes },
        ],
      },
    ].map((s) => ({ ...s, heading: s.heading || " " }));
    const requirements = applicableRequirements(bundle.requirements, graph.grade.sort_order);
    const documents = requirements.map((q) => {
      const d = liveDocument(bundle.documents, q.code);
      const status = !d ? (q.required ? "Not received" : "Not provided (optional)") : d.review_status === "accepted" ? "Accepted" : d.review_status === "rejected" ? "Rejected, awaiting a new upload" : "Received, awaiting review";
      return { label: q.label, status, filename: d?.original_filename ?? null, uploadedOn: d ? formatDateLong(d.uploaded_at) : null };
    });
    const agreements = bundle.acceptances.map((a) => {
      const t = bundle.agreementTemplates.find((x) => x.id === a.agreement_template_id);
      return { name: t?.name ?? a.template_key, version: a.template_version, acceptedOn: formatDateLong(a.accepted_at), signedBy: a.signature_name };
    });
    const buffer = await render(
      createElement(RegistrationDocument, {
        logoUrl,
        letterhead: graph.campus,
        studentName: nameOf(graph),
        gradeName: graph.grade.name,
        campusName: graph.campus.name,
        intakeLabel: graph.intake.label,
        reference: ref,
        status: graph.application.status,
        submittedOn: r.submitted_at ? formatDateLong(r.submitted_at) : null,
        printedOn: formatDateLong(new Date()),
        sections,
        documents,
        agreements,
      })
    );
    return { buffer, filename: `hibiscus-registration-${ref}.pdf` };
  }

  // agreements
  if (!bundle.acceptances.length) return { unavailable: "No agreements have been signed yet." };
  const ids = [...new Set(bundle.acceptances.map((a) => a.agreement_template_id))];
  const { data: templates } = await admin.from("agreement_templates").select("*").in("id", ids);
  const agreements = bundle.acceptances
    .map((a) => {
      const t = (templates ?? []).find((x) => x.id === a.agreement_template_id);
      return { name: t?.name ?? a.template_key, version: a.template_version, bodyHtml: t?.body_html ?? "<p>The wording of this version is no longer stored.</p>", signatureName: a.signature_name, signaturePath: signaturePathFrom(a.signature_svg), acceptedOn: formatDateLong(a.accepted_at), bodyHash: a.body_hash, sort: t?.sort_order ?? 0 };
    })
    .sort((a, b) => a.sort - b.sort);
  const buffer = await render(createElement(AgreementsDocument, { logoUrl, letterhead: graph.campus, studentName: nameOf(graph), reference: ref, printedOn: formatDateLong(new Date()), agreements }));
  return { buffer, filename: `hibiscus-agreements-${ref}.pdf` };
}
