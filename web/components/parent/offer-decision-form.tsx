"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OfferDecisionState } from "@/app/(parent)/offer/actions";

type Action = (state: OfferDecisionState, formData: FormData) => Promise<OfferDecisionState>;

/**
 * Accept, with a checkbox that must be ticked, or decline with an optional
 * reason. The server validates both; this only keeps the two forms apart.
 */
export function OfferDecisionForm({ accept, decline }: { accept: Action; decline: Action }) {
  const [acceptState, acceptAction, accepting] = useActionState(accept, {});
  const [declineState, declineAction, declining] = useActionState(decline, {});
  const [showDecline, setShowDecline] = useState(false);
  const termsError = acceptState.fields?.terms;

  return (
    <section className="mt-6 space-y-4">
      <form action={acceptAction} className="rounded-2xl border-2 border-primary bg-card p-5" noValidate>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Accept the offer</p>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" name="terms" value="1" className="mt-1 size-5 shrink-0 accent-primary" aria-invalid={Boolean(termsError)} aria-describedby={termsError ? "terms-error" : undefined} />
          <span>I have read the offer and the terms above, and I accept the place on those terms. I understand that the registration and admission fees are payable to secure it.</span>
        </label>
        {termsError ? <p id="terms-error" className="mt-2 text-sm text-destructive">{termsError}</p> : null}
        {acceptState.error ? <p role="alert" className="mt-2 text-sm text-destructive">{acceptState.error}</p> : null}
        <Button type="submit" size="parent" className="mt-4" disabled={accepting || declining}>
          {accepting ? "One moment…" : "Accept offer"}
          {!accepting ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Your acceptance is recorded with the date, time and the version of the offer you saw.</p>
      </form>

      {showDecline ? (
        <form action={declineAction} className="rounded-2xl border border-border bg-card p-5" noValidate>
          <p className="text-sm font-semibold">Decline this offer</p>
          <div className="mt-2 space-y-1.5">
            <Label htmlFor="reason">Would you tell us why? (optional)</Label>
            <Textarea id="reason" name="reason" rows={3} maxLength={500} />
          </div>
          {declineState.error ? <p role="alert" className="mt-2 text-sm text-destructive">{declineState.error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={accepting || declining}>{declining ? "One moment…" : "Decline the offer"}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowDecline(false)}>Keep it open</Button>
          </div>
        </form>
      ) : (
        <p className="text-center text-sm">
          <button type="button" onClick={() => setShowDecline(true)} className="font-medium text-muted-foreground underline underline-offset-2">I do not want to take up this place</button>
        </p>
      )}
    </section>
  );
}
