"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = { error?: string };

/**
 * The address the school writes to, and a way to correct it.
 *
 * Shown closed, as a line of fact, because for almost every parent it is
 * already right and a text box invites a change nobody wanted to make. The
 * parent who needs it is the one whose confirmation never arrived, and they
 * are looking for exactly this.
 *
 * Give it `key={email}` where it is used: a saved address comes back as a
 * new prop when the action revalidates the page, and that is the only proof
 * from here that the change took, so it is what should close the box. A
 * refusal leaves the address alone and the box open with the message on it.
 */
export function EmailAddress({
  email,
  action,
}: {
  email: string;
  action: (state: State, formData: FormData) => Promise<State>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [editing, setEditing] = useState(false);

  return (
    <section aria-label="Your email address" className="mt-6 surface p-4 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">We write to</p>
      {editing ? (
        <form action={formAction} className="mt-2 space-y-2">
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue={email}
            aria-label="Your email address"
            required
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Reminders, the offer and payment details all go to this address, for every child you have applied for.
          </p>
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium break-all">{email}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-medium text-primary underline underline-offset-2"
          >
            Change
          </button>
        </div>
      )}
      {state.error ? <p className="mt-2 text-xs text-destructive">{state.error}</p> : null}
    </section>
  );
}
