"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";

type State = { error?: string };

/**
 * One line on the hub: whether WhatsApp updates are on for this number, and
 * a button to change it. Email is never optional; it is the record.
 */
export function MessagePreferences({
  optedIn,
  mobile,
  action,
}: {
  optedIn: boolean;
  mobile: string;
  action: (state: State, formData: FormData) => Promise<State>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <section aria-label="Message preferences" className="mt-5 rounded-2xl border border-border bg-card p-4 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">WhatsApp updates</p>
      <p className="mt-1">
        {optedIn ? <>On, to {mobile}. Emails still arrive as the full record.</> : <>Off. We can also send short updates to {mobile} on WhatsApp.</>}
      </p>
      <form action={formAction} className="mt-2">
        <input type="hidden" name="optIn" value={optedIn ? "0" : "1"} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : optedIn ? "Turn WhatsApp updates off" : "Turn WhatsApp updates on"}
        </Button>
      </form>
      {state.error ? <p className="mt-2 text-xs text-destructive">{state.error}</p> : null}
    </section>
  );
}
