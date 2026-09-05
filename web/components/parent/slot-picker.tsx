"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FunnelT0Field } from "@/components/parent/funnel-beacon";
import { formatTime } from "@/lib/format-date";
import type { SlotDay } from "@/lib/enquiry";
import type { ActionState } from "@/app/(parent)/next/actions";

/**
 * Dates as headings, times as big buttons. One tap books. No calendar
 * widget: the school publishes a handful of dates and a parent scans a list
 * faster than they operate a date picker on a phone.
 */
export function SlotPicker({
  days,
  action,
}: {
  days: SlotDay[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-6">
      <FunnelT0Field />
      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`day-${day.date}`}>
          <h2 id={`day-${day.date}`} className="mb-2 text-sm font-semibold text-foreground">
            {day.label}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {day.slots.map((slot) => (
              <Button
                key={slot.sessionId}
                type="submit"
                name="sessionId"
                value={slot.sessionId}
                variant="outline"
                disabled={pending}
                className="h-14 flex-col gap-0 rounded-xl text-base font-semibold"
              >
                {formatTime(slot.startsAt)}
                <span className="text-[11px] font-normal text-muted-foreground">
                  {slot.placesLeft === 1 ? "1 place" : `${slot.placesLeft} places`}
                </span>
              </Button>
            ))}
          </div>
          {day.slots[0]?.location ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{day.slots[0].location}</p>
          ) : null}
        </section>
      ))}
    </form>
  );
}
