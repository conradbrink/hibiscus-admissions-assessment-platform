"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RELATIONSHIP_LABELS, RELATIONSHIPS } from "@/lib/registration/schema";

function RelationshipSelect({ name, value, error, readOnly }: { name: string; value: string; error?: string; readOnly: boolean }) {
  return (
    <Field id={name} label="Relationship to the child" error={error}>
      <NativeSelect id={name} name={name} defaultValue={value} disabled={readOnly} {...(error ? { "aria-invalid": true } : {})}>
        <option value="">Choose…</option>
        {RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>)}
      </NativeSelect>
    </Field>
  );
}

export function FamilyForm({
  action,
  primary,
  secondary,
  prefilled,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  primary: Record<string, string>;
  secondary: Record<string, string>;
  prefilled: string[];
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const sv = state.values ?? {};
  const p = (k: string) => sv[`primary.${k}`] ?? primary[k] ?? "";
  const s = (k: string) => sv[`secondary${k[0].toUpperCase()}${k.slice(1)}`] ?? secondary[k] ?? "";
  const pre = (k: string) => prefilled.includes(`primary.${k}`);
  const input = (name: string, label: string, value: string, opts: { required?: boolean; type?: string; hint?: string; prefilled?: boolean } = {}) => (
    <Field id={name} label={label} error={f[name]} hint={opts.hint} prefilled={opts.prefilled}>
      <Input id={name} name={name} type={opts.type ?? "text"} defaultValue={value} required={opts.required} readOnly={readOnly} {...invalidProps(f, name)} />
    </Field>
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Primary parent or guardian</legend>
        <p className="text-xs text-muted-foreground">The person the school contacts first. You enquired with these details; check they are still right.</p>
        {input("primary.firstName", "First name", p("firstName"), { required: true, prefilled: pre("firstName") })}
        {input("primary.lastName", "Surname", p("lastName"), { required: true, prefilled: pre("lastName") })}
        <RelationshipSelect name="primary.relationship" value={p("relationship")} error={f["primary.relationship"]} readOnly={readOnly} />
        {input("primary.email", "Email", p("email"), { required: true, type: "email", prefilled: pre("email") })}
        {input("primary.mobile", "Mobile", p("mobile"), { required: true, type: "tel", prefilled: pre("mobile") })}
        {input("primary.phone", "Other phone", p("phone"), { type: "tel" })}
        {input("primary.address", "Home address", p("address"))}
        {input("primary.nationality", "Nationality", p("nationality"))}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Second parent or guardian</legend>
        <p className="text-xs text-muted-foreground">Optional. Leave the whole section blank if there is nobody else.</p>
        {input("secondaryFirstName", "First name", s("firstName"))}
        {input("secondaryLastName", "Surname", s("lastName"))}
        <RelationshipSelect name="secondaryRelationship" value={s("relationship")} error={f.secondaryRelationship} readOnly={readOnly} />
        {input("secondaryEmail", "Email", s("email"), { type: "email" })}
        {input("secondaryMobile", "Mobile", s("mobile"), { type: "tel" })}
        {input("secondaryPhone", "Other phone", s("phone"), { type: "tel" })}
        {input("secondaryAddress", "Home address, if different", s("address"))}
        {input("secondaryNationality", "Nationality", s("nationality"))}
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
