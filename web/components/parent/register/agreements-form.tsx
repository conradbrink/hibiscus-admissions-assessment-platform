"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, invalidProps, type RegisterFormState } from "@/components/parent/register/field";
import { SignaturePad } from "@/components/parent/register/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AcceptedAgreement = { signatureName: string; acceptedAt: string; signatureDataUrl: string | null };

export function AgreementsForm({
  action,
  agreements,
  accepted,
  signerName,
  readOnly,
}: {
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  agreements: Array<{ key: string; name: string; bodyHtml: string; required: boolean; documentUrl: string | null }>;
  accepted: Record<string, AcceptedAgreement>;
  signerName: string;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const signed = Object.values(accepted).find((a) => a.signatureDataUrl) ?? null;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {agreements.map((a) => (
        <section key={a.key} className="rounded-2xl border border-border bg-card p-4">
          <div className="prose prose-sm max-h-96 max-w-none overflow-y-auto pr-2" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
          {a.documentUrl ? (
            <a href={a.documentUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-2">
              Open the {a.name} as a PDF (opens in a new tab)
            </a>
          ) : null}
          <label className="mt-3 flex items-start gap-3 text-sm">
            <input type="checkbox" name={`agree_${a.key}`} value="1" defaultChecked={!!accepted[a.key]} disabled={readOnly} className="mt-1 size-5 shrink-0 accent-primary" aria-invalid={Boolean(f[`agree_${a.key}`])} />
            <span>I have read and accept the {a.name}{a.required ? "" : " (optional)"}.</span>
          </label>
          {f[`agree_${a.key}`] ? <p className="mt-1 text-sm text-destructive">{f[`agree_${a.key}`]}</p> : null}
          {accepted[a.key] ? <p className="mt-1 text-xs text-muted-foreground">Accepted by {accepted[a.key].signatureName} on {accepted[a.key].acceptedAt}.</p> : null}
        </section>
      ))}
      {!readOnly ? (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Your signature</h2>
          <div className="space-y-1.5">
            <Label>Sign in the box</Label>
            <SignaturePad name="signature" error={f.signature} />
            {f.signature ? <p id="signature-error" className="text-sm text-destructive">{f.signature}</p> : null}
          </div>
          <Field id="signatureName" label="Your full name, printed" error={f.signatureName} hint={`Type ${signerName}, as on the enquiry.`}>
            <Input id="signatureName" name="signatureName" defaultValue={state.values?.signatureName ?? ""} autoComplete="off" required {...invalidProps(f, "signatureName")} />
          </Field>
          {state.error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="parent" disabled={pending}>
            {pending ? "Saving…" : "Sign and continue"}
            {!pending ? <ArrowRight data-icon="inline-end" /> : null}
          </Button>
        </section>
      ) : signed?.signatureDataUrl ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Your signature</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signed.signatureDataUrl} alt={`Signature of ${signed.signatureName}`} className="mt-2 h-24 w-auto max-w-full rounded-xl border border-border bg-white" />
          <p className="mt-1 text-xs text-muted-foreground">{signed.signatureName}, {signed.acceptedAt}.</p>
        </section>
      ) : null}
    </form>
  );
}
