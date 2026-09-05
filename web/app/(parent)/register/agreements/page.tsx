import type { Metadata } from "next";
import { AgreementsForm } from "@/components/parent/register/agreements-form";
import { RegisterShell } from "@/components/parent/register/shell";
import { formatDateLong } from "@/lib/format-date";
import { registrationForSession } from "@/lib/registration/session";
import { acceptAgreements } from "../actions";

export const metadata: Metadata = { title: "Registration — agreements" };

export default async function AgreementsStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const primary = bundle.contacts.find((c) => c.kind === "primary_guardian");
  const signer = `${primary?.first_name ?? graph.contact.first_name} ${primary?.last_name ?? graph.contact.last_name}`;
  const accepted: Record<string, { signatureName: string; acceptedAt: string }> = {};
  for (const a of bundle.acceptances) accepted[a.template_key] = { signatureName: a.signature_name, acceptedAt: formatDateLong(a.accepted_at) };
  return (
    <RegisterShell step="agreements" title="Agreements" description="Please read each one. Typing your name is your signature." readOnly={!editable}>
      <AgreementsForm
        action={acceptAgreements}
        agreements={bundle.agreementTemplates.map((t) => ({ key: t.key, name: t.name, bodyHtml: t.body_html, required: t.required }))}
        accepted={accepted}
        signerName={signer}
        readOnly={!editable}
      />
    </RegisterShell>
  );
}
