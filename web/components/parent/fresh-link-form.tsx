"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FreshLinkState } from "@/app/(parent)/link/actions";

export function FreshLinkForm({
  action,
}: {
  action: (state: FreshLinkState, formData: FormData) => Promise<FreshLinkState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};

  if (state.done) {
    return (
      <div className="rounded-2xl bg-success/10 p-5">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          If those details match an application, a fresh link is on its way. It can take a minute
          to arrive, and it is worth checking your spam folder.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email address you enquired with</Label>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required aria-invalid={Boolean(f.email)} />
        {f.email ? <p className="text-sm text-destructive">{f.email}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reference">Application reference</Label>
        <Input id="reference" name="reference" placeholder="HBS-2026-00482" autoCapitalize="characters" required aria-invalid={Boolean(f.reference)} />
        {f.reference ? (
          <p className="text-sm text-destructive">{f.reference}</p>
        ) : (
          <p className="text-xs text-muted-foreground">It is at the top of every email we have sent you.</p>
        )}
      </div>
      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "One moment…" : "Email me a new link"}
      </Button>
    </form>
  );
}
