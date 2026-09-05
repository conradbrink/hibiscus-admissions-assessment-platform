"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AgreementsForm({
  action,
  agreements,
  accepted,
  signerName,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  agreements: Array<{ key: string; name: string; bodyHtml: string; required: boolean }>;
  accepted: Record<string, { signatureName: string; acceptedAt: string }>;
  signerName: string;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {agreements.map((a) => (
        <section key={a.key} className="rounded-2xl border border-border bg-card p-4">
          <div className="prose prose-sm max-h-72 max-w-none overflow-y-auto" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
          <label className="mt-3 flex items-start gap-3 text-sm">
            <input type="checkbox" name={`agree_${a.key}`} value="1" defaultChecked={!!accepted[a.key]} disabled={readOnly} className="mt-1 size-5 shrink-0 accent-primary" aria-invalid={Boolean(f[`agree_${a.key}`])} />
            <span>I have read and accept the {a.name.toLowerCase()}{a.required ? "" : " (optional)"}.</span>
          </label>
          {f[`agree_${a.key}`] ? <p className="mt-1 text-sm text-destructive">{f[`agree_${a.key}`]}</p> : null}
          {accepted[a.key] ? <p className="mt-1 text-xs text-muted-foreground">Accepted by {accepted[a.key].signatureName} on {accepted[a.key].acceptedAt}.</p> : null}
        </section>
      ))}
      {!readOnly ? (
        <>
          <Field id="signatureName" label="Your full name, as your signature" error={f.signatureName} hint={`Type ${signerName}.`}>
            <Input id="signatureName" name="signatureName" defaultValue={state.values?.signatureName ?? ""} autoComplete="off" required {...invalidProps(f, "signatureName")} />
          </Field>
          {state.error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="parent" disabled={pending}>
            {pending ? "Saving…" : "Sign and continue"}
            {!pending ? <ArrowRight data-icon="inline-end" /> : null}
          </Button>
        </>
      ) : null}
    </form>
  );
}
