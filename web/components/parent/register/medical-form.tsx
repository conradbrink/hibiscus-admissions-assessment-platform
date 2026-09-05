"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function MedicalForm({
  action,
  initial,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  initial: Record<string, string>;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const v = { ...initial, ...(state.values ?? {}) };
  const area = (name: string, label: string, hint?: string) => (
    <Field id={name} label={label} error={f[name]} hint={hint}>
      <Textarea id={name} name={name} rows={2} defaultValue={v[name] ?? ""} readOnly={readOnly} {...invalidProps(f, name)} />
    </Field>
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Medical aid</legend>
        <p className="text-xs text-muted-foreground">Leave blank if the child is not on a medical aid.</p>
        <Field id="medicalAidName" label="Medical aid" error={f.medicalAidName}><Input id="medicalAidName" name="medicalAidName" defaultValue={v.medicalAidName ?? ""} readOnly={readOnly} /></Field>
        <Field id="medicalAidNumber" label="Membership number" error={f.medicalAidNumber}><Input id="medicalAidNumber" name="medicalAidNumber" defaultValue={v.medicalAidNumber ?? ""} readOnly={readOnly} /></Field>
        <Field id="medicalAidPrincipalMember" label="Principal member" error={f.medicalAidPrincipalMember}><Input id="medicalAidPrincipalMember" name="medicalAidPrincipalMember" defaultValue={v.medicalAidPrincipalMember ?? ""} readOnly={readOnly} /></Field>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Emergency treatment</legend>
        <p className="text-sm">If the school cannot reach you in an emergency, may it authorise a doctor to treat the child?</p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="emergencyTreatmentConsent" value="yes" defaultChecked={v.emergencyTreatmentConsent === "yes"} disabled={readOnly} className="size-5 accent-primary" /> Yes</label>
          <label className="flex items-center gap-2"><input type="radio" name="emergencyTreatmentConsent" value="no" defaultChecked={v.emergencyTreatmentConsent === "no"} disabled={readOnly} className="size-5 accent-primary" /> No, call me first</label>
        </div>
        {f.emergencyTreatmentConsent ? <p className="text-sm text-destructive">{f.emergencyTreatmentConsent}</p> : null}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Health</legend>
        <p className="text-xs text-muted-foreground">Only what the school should know to keep the child safe. Write &ldquo;none&rdquo; where nothing applies.</p>
        {area("allergies", "Allergies")}
        {area("medicalConditions", "Medical conditions")}
        {area("medication", "Regular medication")}
        {area("vaccinationNotes", "Vaccinations", "Anything the vaccination card does not show, e.g. an outstanding dose.")}
        {area("medicalNotes", "Anything else the school should know")}
      </fieldset>
      {state.error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
      {!readOnly ? (
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
          {!pending ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
      ) : null}
    </form>
  );
}
