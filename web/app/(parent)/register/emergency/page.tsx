import type { Metadata } from "next";
import { EmergencyForm } from "@/components/parent/register/emergency-form";
import { RegisterShell } from "@/components/parent/register/shell";
import { registrationForSession } from "@/lib/registration/session";
import { saveEmergency } from "../actions";

export const metadata: Metadata = { title: "Registration — emergency contacts" };

export default async function EmergencyStep() {
  const { bundle, editable } = await registrationForSession();
  const initial: Record<string, string> = {};
  for (const c of bundle.contacts.filter((c) => c.kind === "emergency")) {
    const n = `c${c.position}`;
    initial[`${n}.firstName`] = c.first_name;
    initial[`${n}.lastName`] = c.last_name;
    initial[`${n}.relationship`] = c.relationship;
    initial[`${n}.phone`] = c.phone ?? "";
    initial[`${n}.email`] = c.email ?? "";
    initial[`${n}.address`] = c.address ?? "";
  }
  return (
    <RegisterShell step="emergency" title="Emergency contacts" description="Who the school calls if it cannot reach a parent." readOnly={!editable}>
      <EmergencyForm action={saveEmergency} initial={initial} readOnly={!editable} />
    </RegisterShell>
  );
}
