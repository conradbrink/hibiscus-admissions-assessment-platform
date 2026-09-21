import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import type { TrialWeekRow } from "@/lib/supabase/types";
import { formatTrialWeek } from "@/lib/workflow/trial-week-dates";

/**
 * A free trial week as it stands, and the four things that can come of it.
 *
 * Shared by the review queue and the applicant's Decision tab, because a week
 * offered from one has to be closed out from the other — staff invite a family
 * from wherever they happen to be looking, and then the teachers tell them on
 * Friday how it went. Two copies of these buttons would have drifted the first
 * time one of the four moves changed.
 *
 * The action is a prop rather than an import: each page revalidates its own
 * paths, so the queue passes the queue's action and the applicant page passes
 * its own. Everything else — the wording, the moves, the confirm — is here
 * once.
 */

export const TRIAL_LABELS: Record<TrialWeekRow["status"], string> = {
  invited: "invited, waiting for the family to confirm",
  confirmed: "confirmed by the family",
  attended: "attended",
  no_show: "did not come",
  cancelled: "cancelled",
};

export function TrialWeekStatus({
  applicationId,
  trial,
  canDecide,
  action,
}: {
  applicationId: string;
  trial: TrialWeekRow | null;
  canDecide: boolean;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  if (!trial) return null;
  const range = formatTrialWeek({ startsOn: trial.starts_on, endsOn: trial.ends_on });
  const live = trial.status === "invited" || trial.status === "confirmed";
  const id = (
    <>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="trialId" value={trial.id} />
    </>
  );

  // A week that is over is one line: what it was and what came of it. Nothing
  // to press, because the decision itself is the next thing to do.
  if (!live) {
    return (
      <p className={trial.status === "attended" ? "mt-3 rounded-md bg-success/15 px-3 py-2 text-sm" : "mt-3 text-sm text-muted-foreground"}>
        Free trial week {range}: {TRIAL_LABELS[trial.status]}
        {trial.outcome_note ? ` — ${trial.outcome_note}` : ""}.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm">
      <p>
        <strong>Free trial week</strong> {range} · {TRIAL_LABELS[trial.status]}
        {trial.note ? ` · ${trial.note}` : ""}
      </p>
      {canDecide ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {trial.status === "invited" ? (
            <ActionForm action={action} label="Family confirmed" size="xs" variant="outline">
              {id}
              <input type="hidden" name="status" value="confirmed" />
            </ActionForm>
          ) : null}
          <ActionForm action={action} label="Attended" size="xs" variant="outline" className="flex flex-wrap items-end gap-2">
            {id}
            <input type="hidden" name="status" value="attended" />
            <Input name="note" placeholder="What the teachers said (optional)" className="h-8 w-64 md:h-8" maxLength={500} />
          </ActionForm>
          <ActionForm action={action} label="Did not come" size="xs" variant="outline">
            {id}
            <input type="hidden" name="status" value="no_show" />
          </ActionForm>
          <ActionForm
            action={action}
            label="Cancel the week"
            size="xs"
            variant="ghost"
            confirm="Cancel this trial week? The family is not told automatically; let them know."
          >
            {id}
            <input type="hidden" name="status" value="cancelled" />
          </ActionForm>
        </div>
      ) : null}
    </div>
  );
}
