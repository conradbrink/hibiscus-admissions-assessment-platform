"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { freshLinkAction } from "@/app/(applicant)/apply/actions";

export function FreshLinkForm() {
  const [state, action, pending] = useActionState(freshLinkAction, {});
  if (state.sent) {
    return (
      <p role="status" className="flex items-start gap-3 rounded-xl bg-muted px-5 py-4 text-[15px]">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        If that address has an application, a new link is on its way. Check your inbox and spam folder.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required aria-describedby={state.error ? "email-error" : undefined} aria-invalid={!!state.error} />
        {state.error ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "Sending…" : "Email me a new link"}
      </Button>
    </form>
  );
}
