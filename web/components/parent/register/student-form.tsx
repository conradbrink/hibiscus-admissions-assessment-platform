"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { GENDERS, IDENTITY_TYPES } from "@/lib/registration/schema";

const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = { female: "Female", male: "Male", other: "Other", undisclosed: "Prefer not to say" };
const ID_LABELS: Record<(typeof IDENTITY_TYPES)[number], string> = { omang: "Omang", passport: "Passport", birth_certificate: "Birth certificate number", other: "Other" };

export function StudentForm({
  action,
  initial,
  prefilled,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  initial: Record<string, string>;
  prefilled: string[];
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const v = { ...initial, ...(state.values ?? {}) };
  const pre = (name: string) => prefilled.includes(name);
  const text = (name: string, label: string, opts: { hint?: string; required?: boolean; autoComplete?: string } = {}) => (
    <Field id={name} label={label} error={f[name]} hint={opts.hint} prefilled={pre(name)}>
      <Input id={name} name={name} defaultValue={v[name] ?? ""} required={opts.required} autoComplete={opts.autoComplete} readOnly={readOnly} {...invalidProps(f, name)} />
    </Field>
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Legal name</legend>
        {text("legalFirstName", "First name", { required: true, hint: "As on the birth certificate." })}
        {text("legalMiddleNames", "Middle names")}
        {text("legalLastName", "Surname", { required: true })}
        {text("preferredName", "Preferred name", { hint: "What teachers should call them, if different." })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">About the child</legend>
        <Field id="gender" label="Gender" error={f.gender}>
          <NativeSelect id="gender" name="gender" defaultValue={v.gender ?? ""} disabled={readOnly} {...invalidProps(f, "gender")}>
            <option value="">Choose…</option>
            {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
          </NativeSelect>
        </Field>
        <Field id="dateOfBirth" label="Date of birth" error={f.dateOfBirth} prefilled={pre("dateOfBirth")}>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v.dateOfBirth ?? ""} required readOnly={readOnly} {...invalidProps(f, "dateOfBirth")} />
        </Field>
        {text("nationality", "Nationality", { required: true })}
        {text("countryOfBirth", "Country of birth", { required: true })}
        {text("placeOfBirth", "Town or city of birth")}
        {text("homeLanguage", "Language spoken at home", { required: true })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Identity</legend>
        <Field id="identityType" label="Identity document" error={f.identityType}>
          <NativeSelect id="identityType" name="identityType" defaultValue={v.identityType ?? ""} disabled={readOnly} {...invalidProps(f, "identityType")}>
            <option value="">Choose…</option>
            {IDENTITY_TYPES.map((t) => <option key={t} value={t}>{ID_LABELS[t]}</option>)}
          </NativeSelect>
        </Field>
        {text("identityNumber", "Identity or registration number", { required: true })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Schooling so far</legend>
        {text("previousInstitution", "Current or previous school", { hint: "Leave blank if this is their first school." })}
        {text("currentGrade", "Current grade")}
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
