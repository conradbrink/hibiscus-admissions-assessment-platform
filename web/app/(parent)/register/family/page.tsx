import type { Metadata } from "next";
import { FamilyForm } from "@/components/parent/register/family-form";
import { RegisterShell } from "@/components/parent/register/shell";
import { prefillRegistration } from "@/lib/registration/prefill";
import { registrationForSession } from "@/lib/registration/session";
import { saveFamily } from "../actions";

export const metadata: Metadata = { title: "Registration — family" };

export default async function FamilyStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const primary = bundle.contacts.find((c) => c.kind === "primary_guardian") ?? null;
  const secondary = bundle.contacts.find((c) => c.kind === "secondary_guardian") ?? null;
  const prefill = prefillRegistration(graph, bundle.registration, primary);
  const secondaryValues: Record<string, string> = {
    firstName: secondary?.first_name ?? "",
    lastName: secondary?.last_name ?? "",
    relationship: secondary?.relationship ?? "",
    email: secondary?.email ?? "",
    mobile: secondary?.mobile ?? "",
    phone: secondary?.phone ?? "",
    address: secondary?.address ?? "",
    nationality: secondary?.nationality ?? "",
  };
  return (
    <RegisterShell step="family" title="Parents and guardians" description="Who the school talks to, and who else may collect the child." readOnly={!editable}>
      <FamilyForm action={saveFamily} primary={prefill.primary} secondary={secondaryValues} prefilled={prefill.prefilledFields} readOnly={!editable} whatsappOptIn={graph.contact.whatsapp_opt_in} />
    </RegisterShell>
  );
}
