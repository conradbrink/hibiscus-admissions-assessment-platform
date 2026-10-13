"use client";

import { useState } from "react";
import { Check, Clock, X, CalendarDays } from "lucide-react";
import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { nextMonday } from "@/lib/workflow/trial-week-dates";

type Choice = "approved" | "waitlisted" | "declined" | "trial_week";

const SAVE_LABEL: Record<Choice, string> = {
  approved: "Accept applicant",
  waitlisted: "Add to waitlist",
  declined: "Decline application",
  trial_week: "Invite to trial week",
};

/**
 * Make the admission decision, on the applicant's own page.
 *
 * Three answers as three buttons rather than a dropdown, because the choice
 * is the whole point of the moment and a select hides it. The note is the
 * reason the engine requires and audits; it is asked for in the same breath.
 * Saving posts to the same `recordDecision` action the old Decision tab used,
 * with the same confirmations, so the letters, tasks and offer drafting that
 * follow are unchanged — and the page's Next step moves on by itself.
 *
 * Deferring and withdrawing are not here: they are not judgements about the
 * child, and they live under More actions at every stage.
 */
export function DecisionPanel({
  applicationId,
  action,
  canWaitlist,
  canDecline,
  canOfferTrial,
  hasHadTrial,
  autoSendOutcomes,
  upcomingBooking,
}: {
  applicationId: string;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  canWaitlist: boolean;
  canDecline: boolean;
  /** Pre-school, undecided, no week already running. */
  canOfferTrial: boolean;
  hasHadTrial: boolean;
  autoSendOutcomes: boolean;
  upcomingBooking: boolean;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const options: Array<{ value: Choice; label: string; icon: typeof Check; on: string }> = [
    { value: "approved", label: "Accept", icon: Check, on: "border-success bg-success/10 text-success" },
    ...(canWaitlist ? [{ value: "waitlisted" as const, label: "Waitlist", icon: Clock, on: "border-warning bg-warning/20 text-warning-foreground" }] : []),
    ...(canDecline ? [{ value: "declined" as const, label: "Decline", icon: X, on: "border-destructive bg-destructive/10 text-destructive" }] : []),
    ...(canOfferTrial ? [{ value: "trial_week" as const, label: hasHadTrial ? "Another trial week" : "Trial week first", icon: CalendarDays, on: "border-info bg-info/10 text-info" }] : []),
  ];
  const letter = choice === "waitlisted" ? "waitlist" : "decline";

  return (
    <ActionForm
      action={action}
      // The button says what saving does, once there is something to save.
      label={choice ? SAVE_LABEL[choice] : "Choose a decision"}
      size="lg"
      className="space-y-3"
      // A note typed and then refused (too short, a stale page) must survive.
      resetOnSubmit={false}
      confirmBy={{
        field: "outcome",
        messages: {
          trial_week: "Invite the family to a free trial week? They are emailed the dates now.",
          approved: "Accept this applicant? It is audited, and the offer is drafted for approval.",
          waitlisted: autoSendOutcomes
            ? "Waitlist this applicant? It is audited, and the waitlist letter is emailed to the parent now."
            : "Waitlist this applicant? It is audited. The letter is sent from this page once you press Send.",
          declined:
            (autoSendOutcomes
              ? "Decline this applicant? It is audited, and the decline letter is emailed to the parent now."
              : "Decline this applicant? It is audited. The letter is sent from this page once you press Send.") +
            (upcomingBooking ? " Their booking is cancelled when the letter goes." : ""),
        },
      }}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <fieldset>
        <legend className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Make admission decision</legend>
        <div className={cn("grid gap-2", options.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
          {options.map((o) => {
            const Icon = o.icon;
            const selected = choice === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  selected ? o.on : "border-border bg-card text-foreground hover:bg-muted"
                )}
              >
                <input
                  type="radio"
                  name="outcome"
                  value={o.value}
                  checked={selected}
                  onChange={() => setChoice(o.value)}
                  className="sr-only"
                  required
                />
                <Icon className="size-4" aria-hidden />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {choice === "trial_week" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            The child comes each morning for the week. The family is emailed these dates now; you decide once the week is done.
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Week starting</span>
              <Input type="date" name="startsOn" defaultValue={nextMonday(new Date())} required className="w-40" />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Last day (blank: the Friday)</span>
              <Input type="date" name="endsOn" className="w-40" />
            </label>
          </div>
          <Input name="note" placeholder="For the parent: what time to come, what to bring (optional)" maxLength={500} />
        </div>
      ) : (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Decision note</span>
          <Textarea name="reason" rows={2} required minLength={5} placeholder="Why — a few words. Kept on the record and audited." />
          {choice === "waitlisted" || choice === "declined" ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {autoSendOutcomes
                ? `The ${letter} letter is emailed to the parent as soon as you save.`
                : `Nothing is emailed yet: you send the ${letter} letter from this page next.`}
              {choice === "declined" && upcomingBooking ? " Their booking is cancelled when the letter goes." : ""}
            </span>
          ) : null}
        </label>
      )}
    </ActionForm>
  );
}
