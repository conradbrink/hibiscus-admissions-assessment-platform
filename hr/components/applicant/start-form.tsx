"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StartState } from "@/app/(public)/vacancies/[slug]/actions";

/** Three fields and a promise: the first win is "started and saved" in under a minute. */
export function StartForm({ action }: { action: (state: StartState, formData: FormData) => Promise<StartState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.sent) {
    return (
      <div role="status" className="space-y-2">
        <MailCheck className="size-6 text-primary" aria-hidden />
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">
          You have already started an application for this post with {state.values?.email}. We have sent the link to that address again.
        </p>
      </div>
    );
  }
  const err = state.fieldErrors ?? {};
  const field = (name: "first_name" | "last_name" | "email", label: string, props: React.ComponentProps<typeof Input>) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={state.values?.[name]} aria-invalid={!!err[name]} aria-describedby={err[name] ? `${name}-error` : undefined} {...props} />
      {err[name] ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {err[name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {field("first_name", "First name", { autoComplete: "given-name", required: true })}
        {field("last_name", "Last name", { autoComplete: "family-name", required: true })}
      </div>
      {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email", required: true })}
      <div className="space-y-3 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" aria-describedby={err.consent ? "consent-error" : undefined} />
          <span>
            I agree that Hibiscus International Schools may use my information to consider my application, as the privacy notice below explains.
          </span>
        </label>
        {err.consent ? (
          <p id="consent-error" className="text-sm text-destructive">
            {err.consent}
          </p>
        ) : null}
        <label className="flex items-start gap-3 text-muted-foreground">
          <input type="checkbox" name="talent_pool" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
          <span>If this post is not for me, keep my details for 24 months and tell me about other posts.</span>
        </label>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "Starting…" : "Start my application"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">We email you a link so you can stop and come back any time.</p>
    </form>
  );
}
