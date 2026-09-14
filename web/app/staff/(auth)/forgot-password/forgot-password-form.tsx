"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {});
  if (state.done) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        If that address belongs to a staff account, a reset link is on its way. It works once and for one hour; check your junk folder if it has not arrived in a few minutes.
      </p>
    );
  }
  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
