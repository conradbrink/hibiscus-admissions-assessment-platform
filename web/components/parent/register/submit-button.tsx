"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import type { RegisterFormState } from "@/components/parent/register/field";
import { Button } from "@/components/ui/button";

/** A single big button bound to a zero-argument server action, with its error. */
export function SubmitButton({ action, label, pendingLabel, variant = "default" }: { action: () => Promise<RegisterFormState>; label: string; pendingLabel: string; variant?: "default" | "outline" }) {
  const [state, formAction, pending] = useActionState(async () => action(), {});
  return (
    <form action={formAction}>
      {state.error ? <p role="alert" className="mb-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="parent" variant={variant} disabled={pending}>
        {pending ? pendingLabel : label}
        {!pending ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
    </form>
  );
}
