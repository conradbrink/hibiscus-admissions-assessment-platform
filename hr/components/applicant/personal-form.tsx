"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { YesNo } from "@/components/applicant/yes-no";
import { savePersonalAction } from "@/app/(applicant)/apply/actions";

type Values = { first_name: string; last_name: string; phone: string; nationality: string; is_citizen: string };

export function PersonalForm({ initial, email, country }: { initial: Values; email: string; country: string }) {
  const [state, action, pending] = useActionState(savePersonalAction, {});
  const [citizen, setCitizen] = useState(initial.is_citizen);
  const err = state.fieldErrors ?? {};
  const text = (name: keyof Values, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={initial[name]} aria-invalid={!!err[name]} aria-describedby={err[name] ? `${name}-error` : undefined} {...props} />
      {err[name] ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {err[name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <form action={action} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        {text("first_name", "First name", { autoComplete: "given-name" })}
        {text("last_name", "Last name", { autoComplete: "family-name" })}
        {text("phone", "Mobile number", { type: "tel", autoComplete: "tel", placeholder: "+267 71 234 567" })}
        {text("nationality", "Nationality", { autoComplete: "country-name" })}
      </div>
      <p className="text-sm text-muted-foreground">
        We write to you at <span className="font-medium text-foreground">{email}</span>.
      </p>
      <YesNo name="is_citizen" legend={`Are you a citizen of ${country}?`} value={citizen} onChange={setCitizen} error={err.is_citizen} hint="If not, we ask about your work permit later. It does not stop you applying." />
      {state.error && !Object.keys(err).length ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="border-t border-border pt-6 sm:w-72">
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
