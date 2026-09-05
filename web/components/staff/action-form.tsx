"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StaffActionState = { error?: string; ok?: boolean };

/**
 * A server action as a button, with an error line. Most staff actions are
 * "press this, it happens": check in, mark no-show, complete task. Children
 * are extra fields rendered inside the form (a reason, a select).
 */
export function ActionForm({
  action,
  label,
  variant = "default",
  size = "default",
  className,
  confirm,
  children,
}: {
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "success";
  size?: "default" | "sm" | "xs" | "lg";
  className?: string;
  confirm?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={cn("space-y-2", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
