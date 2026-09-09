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
  id,
  children,
}: {
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "success";
  size?: "default" | "sm" | "xs" | "lg";
  className?: string;
  confirm?: string;
  /**
   * Give the form an id when fields outside it belong to it — a column of
   * checkboxes in a table, say, which cannot sit inside the form itself.
   * Those fields carry `form="<this id>"` and are submitted with it.
   */
  id?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      id={id}
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
