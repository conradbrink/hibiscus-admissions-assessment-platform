"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RELATIONSHIP_LABELS, RELATIONSHIPS } from "@/lib/registration/schema";

export function EmergencyForm({
  action,
  initial,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  /** Keys like "c1.firstName". */
  initial: Record<string, string>;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const v = { ...initial, ...(state.values ?? {}) };
  const block = (i: 1 | 2) => {
    const n = (k: string) => `c${i}.${k}`;
    return (
      <fieldset key={i} className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">{i === 1 ? "Emergency contact" : "Second emergency contact (optional)"}</legend>
        {i === 1 ? <p className="text-xs text-muted-foreground">Somebody other than the parents above who can be reached during the school day.</p> : null}
        <Field id={n("firstName")} label="First name" error={f[n("firstName")]}><Input id={n("firstName")} name={n("firstName")} defaultValue={v[n("firstName")] ?? ""} readOnly={readOnly} {...invalidProps(f, n("firstName"))} /></Field>
        <Field id={n("lastName")} label="Surname" error={f[n("lastName")]}><Input id={n("lastName")} name={n("lastName")} defaultValue={v[n("lastName")] ?? ""} readOnly={readOnly} {...invalidProps(f, n("lastName"))} /></Field>
        <Field id={n("relationship")} label="Relationship to the child" error={f[n("relationship")]}>
          <NativeSelect id={n("relationship")} name={n("relationship")} defaultValue={v[n("relationship")] ?? ""} disabled={readOnly}>
            <option value="">Choose…</option>
            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>)}
          </NativeSelect>
        </Field>
        <Field id={n("phone")} label="Phone" error={f[n("phone")]}><Input id={n("phone")} name={n("phone")} type="tel" defaultValue={v[n("phone")] ?? ""} readOnly={readOnly} {...invalidProps(f, n("phone"))} /></Field>
        <Field id={n("email")} label="Email" error={f[n("email")]}><Input id={n("email")} name={n("email")} type="email" defaultValue={v[n("email")] ?? ""} readOnly={readOnly} /></Field>
        <Field id={n("address")} label="Address" error={f[n("address")]}><Input id={n("address")} name={n("address")} defaultValue={v[n("address")] ?? ""} readOnly={readOnly} /></Field>
      </fieldset>
    );
  };
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {block(1)}
      {block(2)}
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
