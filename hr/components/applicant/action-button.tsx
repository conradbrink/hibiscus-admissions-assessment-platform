"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/app/(applicant)/apply/actions";

/** A single-button form for an applicant action: send, finish a section, withdraw. */
export function ApplicantActionButton({
  action,
  label,
  pendingLabel,
  variant = "default",
  confirm,
  size = "parent",
}: {
  action: (state: FormState) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  confirm?: string;
  size?: "parent" | "lg";
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
