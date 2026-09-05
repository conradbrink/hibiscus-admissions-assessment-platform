import type { Metadata } from "next";
import { MedicalForm } from "@/components/parent/register/medical-form";
import { RegisterShell } from "@/components/parent/register/shell";
import { registrationForSession } from "@/lib/registration/session";
import { saveMedical } from "../actions";

export const metadata: Metadata = { title: "Registration — medical" };

export default async function MedicalStep() {
  const { bundle, editable } = await registrationForSession();
  const r = bundle.registration;
  const initial: Record<string, string> = {
    medicalAidName: r?.medical_aid_name ?? "",
    medicalAidNumber: r?.medical_aid_number ?? "",
    medicalAidPrincipalMember: r?.medical_aid_principal_member ?? "",
    emergencyTreatmentConsent: r?.emergency_treatment_consent === null || r?.emergency_treatment_consent === undefined ? "" : r.emergency_treatment_consent ? "yes" : "no",
    allergies: r?.allergies ?? "",
    medicalConditions: r?.medical_conditions ?? "",
    medication: r?.medication ?? "",
    medicalNotes: r?.medical_notes ?? "",
    vaccinationNotes: r?.vaccination_notes ?? "",
  };
  return (
    <RegisterShell step="medical" title="Medical information" description="Kept confidential and used only to keep the child safe at school." readOnly={!editable}>
      <MedicalForm action={saveMedical} initial={initial} readOnly={!editable} />
    </RegisterShell>
  );
}
