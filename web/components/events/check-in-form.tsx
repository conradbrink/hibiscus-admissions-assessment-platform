"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CheckInState } from "@/app/staff/(crm)/crm/events/[id]/tickets/actions";

/**
 * The gate: type or scan a ticket number, see at once whether to let the
 * person in. The box empties and takes the focus again after every answer,
 * so the next person in the queue is one scan away. A phone's camera app
 * reads the code on the ticket as its number.
 */
export function CheckInForm({ eventId, action }: { eventId: string; action: (state: CheckInState, formData: FormData) => Promise<CheckInState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, [state]);

  const tone = state.tone;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex gap-2">
        <input type="hidden" name="eventId" value={eventId} />
        <Input
          ref={box}
          name="number"
          aria-label="Ticket number"
          placeholder="HCS-0042-K7Q"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase"
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "…" : "Check in"}
        </Button>
      </form>
      {state.message ? (
        <div
          role="status"
          className={
            tone === "ok"
              ? "flex gap-3 rounded-xl bg-success/12 p-3 text-sm text-success"
              : tone === "warn"
                ? "flex gap-3 rounded-xl bg-warning/25 p-3 text-sm text-warning-foreground"
                : "flex gap-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          }
        >
          <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">{state.message}</p>
            {state.detail ? <p className="mt-0.5 text-foreground/80">{state.detail}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
