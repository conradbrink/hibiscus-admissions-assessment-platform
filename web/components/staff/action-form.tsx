"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitWithoutReset } from "@/lib/staff/submit-without-reset";

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
  confirmBy,
  id,
  resetOnSubmit = true,
  children,
}: {
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "success";
  size?: "default" | "sm" | "xs" | "lg";
  className?: string;
  confirm?: string;
  /**
   * A confirmation that depends on what was chosen in the form.
   *
   * One box now holds several answers — approve, defer, withdraw — and only
   * some of them need a warning. Plain data rather than a callback, because
   * this component is reached from a server component: the field is read at
   * submit time and its value looked up here.
   */
  confirmBy?: { field: string; messages: Record<string, string> };
  /**
   * Give the form an id when fields outside it belong to it — a column of
   * checkboxes in a table, say, which cannot sit inside the form itself.
   * Those fields carry `form="<this id>"` and are submitted with it.
   */
  id?: string;
  /**
   * Whether React may clear the fields once the action resolves.
   *
   * True suits a form that creates something — the note box should empty. It
   * is wrong for a form whose fields are seeded from the row they are about,
   * like the assignee picker on a task: React restores each field to its
   * *mount-time* value, so the moment you assign somebody the control snaps
   * back to "Unassigned" while the database happily holds the new assignee.
   */
  resetOnSubmit?: boolean;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      id={id}
      {...(resetOnSubmit ? { action: formAction } : {})}
      className={cn("space-y-2", className)}
      onSubmit={(e) => {
        const chosen = confirmBy ? String(new FormData(e.currentTarget).get(confirmBy.field) ?? "") : null;
        const question = (chosen !== null ? confirmBy?.messages[chosen] : null) ?? confirm;
        if (question && !window.confirm(question)) {
          e.preventDefault();
          return;
        }
        if (!resetOnSubmit) submitWithoutReset(formAction)(e);
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
