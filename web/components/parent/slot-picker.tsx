"use client";

import { useActionState, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FunnelT0Field } from "@/components/parent/funnel-beacon";
import { dayOfMonth, monthGrid, monthsOf } from "@/lib/calendar";
import { formatTime } from "@/lib/format-date";
import type { SlotDay } from "@/lib/enquiry";
import type { ActionState } from "@/app/(parent)/next/actions";

/**
 * A month at a time, then the times on the day the parent picked.
 *
 * The school publishes a sitting and a visit every weekday, so the list this
 * replaced ran to thirty headings and a parent scrolled four weeks to reach a
 * Thursday. A calendar answers "which days can we come?" in one look; the
 * times stay as big buttons underneath, because that is the tap that books
 * and it should not become a dropdown.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** Monday first: the school week, and the week the sittings are published on. */
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function SlotPicker({
  days,
  action,
}: {
  days: SlotDay[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Every month that has a day in it, in order. The arrows walk this list
  // rather than the calendar, so a parent cannot page into an empty November.
  const months = useMemo(() => monthsOf(days.map((d) => d.date)), [days]);

  // Open on the first day that has times, so the page arrives with something
  // to tap rather than an empty panel and an instruction.
  const [selected, setSelected] = useState(days[0]?.date ?? "");
  const [monthIndex, setMonthIndex] = useState(0);

  if (days.length === 0) return null;

  const [my, mm] = months[monthIndex].split("-").map(Number);
  const cells = monthGrid(months[monthIndex]);

  const selectedDay = byDate.get(selected) ?? null;

  return (
    <form action={formAction} className="space-y-6">
      <FunnelT0Field />
      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
            disabled={monthIndex === 0}
            aria-label="Previous month"
            className="rounded-lg p-2 text-muted-foreground enabled:hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="text-sm font-semibold" aria-live="polite">
            {MONTHS[mm - 1]} {my}
          </p>
          <button
            type="button"
            onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
            disabled={monthIndex === months.length - 1}
            aria-label="Next month"
            className="rounded-lg p-2 text-muted-foreground enabled:hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="pb-1 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (date === null) return <div key={`blank-${i}`} aria-hidden />;
            const day = byDate.get(date);
            const isSelected = date === selected;
            return (
              <button
                key={date}
                type="button"
                disabled={!day}
                aria-pressed={isSelected}
                aria-label={day ? `${day.label}, ${day.slots.length} times` : undefined}
                onClick={() => setSelected(date)}
                className={[
                  "flex aspect-square flex-col items-center justify-center rounded-xl text-sm tabular-nums transition-colors",
                  !day
                    ? "text-muted-foreground/35"
                    : isSelected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "bg-muted font-medium text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {dayOfMonth(date)}
                {day && !isSelected ? <span className="mt-0.5 size-1 rounded-full bg-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay ? (
        <section aria-labelledby="times-heading">
          <h2 id="times-heading" className="mb-2 text-sm font-semibold text-foreground">
            {selectedDay.label}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {selectedDay.slots.map((slot) => (
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
          {selectedDay.slots[0]?.location ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{selectedDay.slots[0].location}</p>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}
