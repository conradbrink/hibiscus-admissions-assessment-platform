import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import type { SummaryView } from "@/lib/summary/generate";

/**
 * The applicant in a paragraph, with the things that need attention as
 * badges. The flags are computed by code and always current; the prose is
 * either the system's plain wording or, when the switch is on and the
 * validator passed, the model's — and says which.
 */
export function SummaryPanel({ applicationId, view, action }: { applicationId: string; view: SummaryView; action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState> }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Summary">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Summary</p>
          <p className="mt-1 text-base font-semibold">{view.headline}</p>
        </div>
        <ActionForm action={action} label={view.stale || view.source === "deterministic" ? (view.aiEnabled ? "Write with AI" : "Refresh") : "Refresh"} variant="ghost" size="xs">
          <input type="hidden" name="applicationId" value={applicationId} />
        </ActionForm>
      </div>
      {view.flags.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {view.flags.map((f) => (
            <li key={f.kind} title={f.evidence}>
              <Badge variant={f.kind === "waiting_on_school" || f.kind === "sibling_applying" ? "secondary" : f.kind === "payment_overdue" || f.kind === "overdue_task" ? "destructive" : "warning"}>{f.label}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-sm">{view.paragraph}</p>
      {view.flags.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {view.flags.map((f) => <li key={f.kind}><span className="font-medium text-foreground">{f.label}:</span> {f.evidence}</li>)}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        {view.source === "ai" ? "Written by the AI over the facts below and checked by the validator" : "Worded by the system from the facts"}
        {view.generatedAt ? ` · ${formatDateTime(view.generatedAt)}` : ""}{view.stale ? " · the stored summary is out of date; the facts shown are current" : ""}.
      </p>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">The facts</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{view.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </details>
    </section>
  );
}
