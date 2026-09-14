import { ActionForm } from "@/components/staff/action-form";
import { DecisionFields } from "@/components/staff/decision-fields";
import type { StaffActionState } from "@/components/staff/action-form";

/**
 * Pausing or closing an application, in the sidebar beside Delete.
 *
 * These used to sit under Decision, which read as "Record a decision" for the
 * whole life of an application — so a child who had been approved, offered and
 * whose parent had already opened the letter still had a form inviting staff
 * to decide them again. The heading was the problem, not the actions.
 *
 * They belong here instead. Deferring and withdrawing are not judgements about
 * a child; they are what happens when a family says "not this year" or "we
 * have taken another place", and they stay available at every stage — which is
 * the point, because a family is most likely to drop out *after* the offer.
 * Delete, directly below, is the one that destroys a record; these two keep it.
 */
export function PauseOrClose({
  applicationId,
  action,
  canDefer,
  canWithdraw,
  bookingWillBeCancelled,
}: {
  applicationId: string;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  canDefer: boolean;
  canWithdraw: boolean;
  bookingWillBeCancelled: boolean;
}) {
  if (!canDefer && !canWithdraw) return null;
  return (
    <section className="surface p-4 text-sm">
      <h2 className="text-sm font-semibold">Pause or close this application</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        For a family who wants a place later, or who is no longer applying. Both keep the record and the figures.
      </p>
      <ActionForm
        action={action}
        label="Save"
        size="sm"
        className="mt-2"
        confirmBy={{
          field: "outcome",
          messages: {
            deferred: bookingWillBeCancelled
              ? "Defer this family? Their booking is cancelled and the seat goes back."
              : "Defer this family? We will message them around the date you chose.",
            withdrawn: "Withdraw this application? Bookings and open tasks are cancelled.",
          },
        }}
      >
        <input type="hidden" name="applicationId" value={applicationId} />
        <DecisionFields
          canRecordOutcome={false}
          canDefer={canDefer}
          canWithdraw={canWithdraw}
          bookingWillBeCancelled={bookingWillBeCancelled}
        />
      </ActionForm>
    </section>
  );
}
