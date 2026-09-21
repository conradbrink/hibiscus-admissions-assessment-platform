"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { nextMonday } from "@/lib/workflow/trial-week-dates";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { WITHDRAWN_REASON_CODES, WITHDRAWN_REASON_LABELS } from "@/lib/workflow/withdrawal";

type Outcome = "trial_week" | "approved" | "deferred" | "withdrawn";

/**
 * The fields inside "Record a decision".
 *
 * Everything a person can do with an undecided applicant, in one list,
 * because that is what somebody looking at the child is deciding between.
 * The free trial week sat only on the review queue and pausing and closing
 * only in the sidebar, so the form headed "Record a decision" offered a
 * single option — Approve — and read as though there were no alternative.
 *
 * The trial week is not a decision and does not write one: it invites the
 * family for a week and leaves the application exactly where it is, to be
 * decided after the child has actually come. It leads the list because for a
 * pre-school child it is what the school wants to do first.
 *
 * Waitlist and decline were here once and have been taken out — the school
 * does not turn a child away through this form. Both remain states an
 * application can be in, because the rules engine can still reach them and
 * history must still read back; they are simply no longer something a person
 * picks.
 *
 * Deferring and withdrawing are answers staff give at this moment, so they are
 * options here rather than buttons further down the page. Each needs something
 * different from the others, though: a date, a reason code, or neither. So the
 * choice drives the fields, because a date box sitting there while somebody
 * approves a child is a box they will wonder about.
 */
export function DecisionFields({
  canRecordOutcome,
  canDefer,
  canWithdraw,
  canOfferTrial = false,
  hasHadTrial = false,
  bookingWillBeCancelled,
}: {
  canRecordOutcome: boolean;
  canDefer: boolean;
  canWithdraw: boolean;
  /** Pre-school, undecided, and no week already running. */
  canOfferTrial?: boolean;
  /** A finished week already: the wording says "another", as the queue's does. */
  hasHadTrial?: boolean;
  /** Said out loud when they pick Defer, because the seat going back is not theirs to undo. */
  bookingWillBeCancelled?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>(
    canOfferTrial ? "trial_week" : canRecordOutcome ? "approved" : canDefer ? "deferred" : "withdrawn"
  );

  return (
    <>
      <NativeSelect
        name="outcome"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as Outcome)}
        aria-label="Decision"
      >
        {canOfferTrial ? (
          <option value="trial_week">{hasHadTrial ? "Another free trial week" : "Free trial week — they come first, we decide after"}</option>
        ) : null}
        {canRecordOutcome ? <option value="approved">Approve now</option> : null}
        {canDefer || canWithdraw ? (
          <optgroup label="Pause or close this application">
            {canDefer ? <option value="deferred">Defer — come back to them later</option> : null}
            {canWithdraw ? <option value="withdrawn">Withdraw — they are no longer applying</option> : null}
          </optgroup>
        ) : null}
      </NativeSelect>

      {outcome === "trial_week" ? (
        <>
          <p className="text-xs text-muted-foreground">
            The child comes each morning for the week and the teachers meet them. The family is emailed these dates
            now. Nothing is decided — the application stays here, and you record the decision once the week is done.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Week starting</span>
              <Input type="date" name="startsOn" defaultValue={nextMonday(new Date())} required className="h-9 w-40 md:h-9" />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Last day (blank: the Friday)</span>
              <Input type="date" name="endsOn" className="h-9 w-40 md:h-9" />
            </label>
          </div>
          <Input name="note" placeholder="For the parent: what time to come, what to bring (optional)" maxLength={500} />
        </>
      ) : null}

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
