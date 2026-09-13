import type { Metadata } from "next";
import { AgreementsForm, type AcceptedAgreement } from "@/components/parent/register/agreements-form";
import { RegisterShell } from "@/components/parent/register/shell";
import { formatDateLong } from "@/lib/format-date";
import { registrationForSession } from "@/lib/registration/session";
import { signatureDataUrl } from "@/lib/registration/signature";
import { acceptAgreements } from "../actions";

export const metadata: Metadata = { title: "Registration — agreements" };

export default async function AgreementsStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const primary = bundle.contacts.find((c) => c.kind === "primary_guardian");
  const signer = `${primary?.first_name ?? graph.contact.first_name} ${primary?.last_name ?? graph.contact.last_name}`;
  const accepted: Record<string, AcceptedAgreement> = {};
  for (const a of bundle.acceptances) {
    accepted[a.template_key] = { signatureName: a.signature_name, acceptedAt: formatDateLong(a.accepted_at), signatureDataUrl: a.signature_svg ? signatureDataUrl(a.signature_svg) : null, decision: a.decision };
  }
  return (
    <RegisterShell step="agreements" title="Agreements" description="Please read each document, tick to accept it, then sign in the box at the end." readOnly={!editable}>
      <AgreementsForm
        action={acceptAgreements}
        // Already scoped to this child's grade by loadRegistrationBundle, so a
        // pre-school family is never shown the learner code of conduct.
        agreements={bundle.agreementTemplates.map((t) => ({ key: t.key, name: t.name, bodyHtml: t.body_html, required: t.required, documentUrl: t.document_url, mayDecline: t.may_decline }))}
        accepted={accepted}
        signerName={signer}
        readOnly={!editable}
      />
    </RegisterShell>
  );
}
