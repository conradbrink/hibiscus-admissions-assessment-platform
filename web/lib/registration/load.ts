import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { registrationCompleteness, type Completeness } from "@/lib/registration/completeness";
import type { AgreementAcceptanceRow, AgreementTemplateRow, DocumentRequirementRow, DocumentRow, RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

/** Everything the registration pages, the staff view and the engine's submit rule read, in one call. */
export type RegistrationBundle = {
  registration: RegistrationRow | null;
  contacts: RegistrationContactRow[];
  documents: DocumentRow[];
  requirements: DocumentRequirementRow[];
  agreementTemplates: AgreementTemplateRow[];
  acceptances: AgreementAcceptanceRow[];
  completeness: Completeness;
};

export async function loadRegistrationBundle(admin: AdminClient, graph: Pick<ApplicationGraph, "application" | "grade">): Promise<RegistrationBundle> {
  const id = graph.application.id;
  const [reg, contacts, documents, requirements, templates, acceptances] = await Promise.all([
    admin.from("registrations").select("*").eq("application_id", id).maybeSingle(),
    admin.from("registration_contacts").select("*").eq("application_id", id).order("kind").order("position"),
    admin.from("documents").select("*").eq("application_id", id).is("deleted_at", null).order("uploaded_at", { ascending: false }),
    admin.from("document_requirements").select("*").eq("is_active", true).order("sort_order"),
    admin.from("agreement_templates").select("*").eq("is_active", true).order("sort_order").order("name"),
    admin.from("agreement_acceptances").select("*").eq("application_id", id),
  ]);
  for (const r of [reg, contacts, documents, requirements, templates, acceptances]) {
    if (r.error) throw new Error(r.error.message);
  }
  const bundle = {
    registration: reg.data ?? null,
    contacts: contacts.data ?? [],
    documents: documents.data ?? [],
    requirements: requirements.data ?? [],
    agreementTemplates: templates.data ?? [],
    acceptances: acceptances.data ?? [],
  };
  return {
    ...bundle,
    completeness: registrationCompleteness({ ...bundle, gradeSort: graph.grade.sort_order }),
  };
}

/** Creates the registration row if the payment step has not already. */
export async function ensureRegistration(admin: AdminClient, applicationId: string): Promise<RegistrationRow> {
  const { data: existing } = await admin.from("registrations").select("*").eq("application_id", applicationId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin.from("registrations").insert({ application_id: applicationId }).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "registration insert failed");
  return data;
}
