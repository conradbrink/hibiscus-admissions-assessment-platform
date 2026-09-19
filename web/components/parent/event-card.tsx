"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateLong, formatTime } from "@/lib/format-date";
import type { FamilyEvent } from "@/lib/family/events";
import { cancelRegistration, registerForEvent, type FamilyActionState } from "@/app/(parent)/family/dates/actions";

/**
 * One invitation, and one big button. Plain English, one idea per line,
 * a phone in mind: the date, the time, the place, and are you coming.
 */
export function EventCard({ event, students }: { event: FamilyEvent; students: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(registerForEvent, {});
  const [cancelState, cancelAction, cancelling] = useActionState<FamilyActionState, FormData>(cancelRegistration, {});
  const registered = event.registration && event.registration.status === "registered";
  const full = event.capacity !== null && event.registered_count >= event.capacity && !registered;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">{event.campus?.name ?? "Every campus"}</p>
      <h2 className="mt-1 text-lg font-semibold">{event.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDateLong(event.starts_at)} at {formatTime(event.starts_at)}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      {event.description ? <p className="mt-2 text-sm">{event.description}</p> : null}

      {registered ? (
        <form action={cancelAction} className="mt-4 space-y-2">
          <p className="text-sm font-medium text-success">You are coming. We have kept a place for you.</p>
          <input type="hidden" name="registrationId" value={event.registration!.id} />
          <Button type="submit" variant="outline" size="sm" disabled={cancelling}>
            {cancelling ? "…" : "We can no longer come"}
          </Button>
          {cancelState.error ? <p className="text-xs text-destructive">{cancelState.error}</p> : null}
        </form>
      ) : full ? (
        <p className="mt-4 text-sm text-muted-foreground">This event is full. We are sorry.</p>
      ) : !event.registration_open ? (
        <p className="mt-4 text-sm text-muted-foreground">Registration has closed.</p>
      ) : (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="eventId" value={event.id} />
          {students.length > 1 ? (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Which child is this about?</span>
              <NativeSelect name="studentId" defaultValue="">
                <option value="">The whole family</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">How many people are coming with you?</span>
            <NativeSelect name="guests" defaultValue="0">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n === 0 ? "Just me" : `${n} other${n === 1 ? "" : "s"}`}</option>
              ))}
            </NativeSelect>
          </label>
          <Button type="submit" size="parent" disabled={pending}>
            {pending ? "…" : "Yes, we are coming"}
          </Button>
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        </form>
      )}
    </div>
  );
}
