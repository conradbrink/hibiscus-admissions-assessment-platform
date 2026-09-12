"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { WITHDRAWN_REASON_CODES, WITHDRAWN_REASON_LABELS } from "@/lib/workflow/withdrawal";

type Outcome = "approved" | "waitlisted" | "declined" | "deferred" | "withdrawn";

/**
 * The fields inside "Record a decision".
 *
 * Deferring and withdrawing are answers staff give at this moment — "not now"
 * and "not at all" — so they are options here rather than buttons further down
 * the page. Each needs something different from the others, though: a date, a
 * reason code, or neither. So the choice drives the fields, because a date box
 * sitting there while somebody approves a child is a box they will wonder
 * about.
 */
export function DecisionFields({
  canRecordOutcome,
  canDefer,
  canWithdraw,
  bookingWillBeCancelled,
}: {
  canRecordOutcome: boolean;
  canDefer: boolean;
  canWithdraw: boolean;
  /** Said out loud when they pick Defer, because the seat going back is not theirs to undo. */
  bookingWillBeCancelled?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>(canRecordOutcome ? "approved" : canDefer ? "deferred" : "withdrawn");

  return (
    <>
      <NativeSelect
        name="outcome"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as Outcome)}
        aria-label="Decision"
      >
        {canRecordOutcome ? (
          <>
            <option value="approved">Approve</option>
            <option value="waitlisted">Waitlist</option>
            <option value="declined">Decline</option>
          </>
        ) : null}
        {canDefer ? <option value="deferred">Defer — come back to them later</option> : null}
        {canWithdraw ? <option value="withdrawn">Withdraw — they are no longer applying</option> : null}
      </NativeSelect>

      {outcome === "deferred" ? (
        <>
          <p className="text-xs text-muted-foreground">
            For a family who wants a place later in the year. We message them around the date and put a call on the
            owner&rsquo;s list for the day itself, and one click brings them back.
            {bookingWillBeCancelled ? " Their booking is cancelled, so the seat goes back and the reminders stop." : ""}
          </p>
          <Input type="date" name="until" required aria-label="Come back to them on" />
          <Input name="reason" placeholder="What they said (optional)" maxLength={500} />
        </>
      ) : outcome === "withdrawn" ? (
        <>
          <p className="text-xs text-muted-foreground">
            Closes the application. Bookings and open tasks are cancelled.
          </p>
          {/* The reason in their own words is often the useful half, but it is
              the code that can be counted — which is why the pick-list is the
              required one. */}
          <NativeSelect name="reasonCode" defaultValue="" required aria-label="Why are they withdrawing?">
            <option value="" disabled>
              Why are they withdrawing?
            </option>
            {WITHDRAWN_REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {WITHDRAWN_REASON_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
          <Input name="reason" placeholder="In their words" required minLength={3} />
        </>
      ) : (
        <Textarea name="reason" placeholder="Reason (required)" rows={2} required minLength={5} />
      )}
    </>
  );
}
