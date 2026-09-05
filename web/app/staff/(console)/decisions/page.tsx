import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import type { RuleResult } from "@/lib/rules/evaluate";
import { requireStaff } from "@/lib/staff/session";
import type { BenchmarkBand, Json } from "@/lib/supabase/types";
import { recordDecision } from "../applications/[id]/actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The review queue: everything a person must decide. Referrals from the
 * rules engine come with the rule that referred them highlighted; pre-school
 * enquiries come with nothing to score, only capacity.
 */
export default async function DecisionsPage() {
  const { supabase, permissions } = await requireStaff("applications.read");
  const canDecide = can(permissions, "decisions.override");

  const { data: apps } = await supabase
    .from("applications")
    .select("id, reference, status, status_changed_at, child_first_name, child_last_name, requires_assessment, campuses(name), grades!applications_grade_id_fkey(name), intakes(label)")
    .in("status", ["staff_review", "awaiting_decision"])
    .order("status_changed_at", { ascending: true });
  const ids = (apps ?? []).map((a) => a.id);

  const [{ data: decisions }, { data: attempts }, { data: subjects }, { data: competencies }] = ids.length
    ? await Promise.all([
        supabase.from("admission_decisions").select("*").in("application_id", ids).order("decided_at", { ascending: false }),
        supabase.from("attempts").select("id, application_id, status, marking_status").in("application_id", ids).order("created_at", { ascending: false }),
        supabase.from("subjects").select("id, name"),
        supabase.from("competencies").select("id, name"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const latestDecision = new Map<string, NonNullable<typeof decisions>[number]>();
  for (const d of decisions ?? []) if (!latestDecision.has(d.application_id)) latestDecision.set(d.application_id, d);
  const latestAttempt = new Map<string, NonNullable<typeof attempts>[number]>();
  for (const a of attempts ?? []) if (!latestAttempt.has(a.application_id)) latestAttempt.set(a.application_id, a);
  const attemptIds = [...latestAttempt.values()].map((a) => a.id);
  const { data: scores } = attemptIds.length
    ? await supabase.from("attempt_scores").select("attempt_id, scope, scope_id, percent, band").in("attempt_id", attemptIds)
    : { data: [] };
  const scopeName = (scope: string, id: string | null) =>
    scope === "overall" ? "Overall" : scope === "subject" ? subjects?.find((s) => s.id === id)?.name ?? "?" : competencies?.find((c) => c.id === id)?.name ?? "?";

  return (
    <>
      <PageTitle title="Review queue" description={`${apps?.length ?? 0} application${apps?.length === 1 ? "" : "s"} waiting for a person's decision. Oldest first.`} />
      {apps?.length ? (
        <div className="space-y-4">
          {apps.map((a) => {
            const decision = latestDecision.get(a.id);
            const attempt = latestAttempt.get(a.id);
            const inputs = (decision?.inputs ?? {}) as { results?: RuleResult[]; reason?: string; places_remaining?: number | null };
            const lines = (scores ?? []).filter((s) => s.attempt_id === attempt?.id);
            const failing = (inputs.results ?? []).filter((r) => r.effect !== "pass");
            return (
              <section key={a.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/staff/applications/${a.id}`} className="font-semibold hover:underline">{a.child_first_name} {a.child_last_name}</Link>
                    <p className="text-xs text-muted-foreground">
                      {one(a.grades)?.name} · {one(a.campuses)?.name} · {one(a.intakes)?.label} · {a.reference} · waiting since {formatDateTime(a.status_changed_at)}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                  {attempt ? <Link href={`/staff/assessments/attempts/${attempt.id}`} className="text-xs text-primary underline underline-offset-2">Assessment</Link> : null}
                </div>

                {inputs.reason ? <p className="mt-3 rounded-md bg-warning/15 px-3 py-2 text-sm">{inputs.reason}</p> : null}
                {!a.requires_assessment ? <p className="mt-3 text-sm text-muted-foreground">Pre-school enquiry: no assessment. Decide on availability.</p> : null}
                {typeof inputs.places_remaining === "number" ? <p className="mt-1 text-xs text-muted-foreground">Places remaining in this grade: {inputs.places_remaining}</p> : null}

                {lines.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lines
                      .sort((x, y) => (x.scope === "overall" ? -1 : y.scope === "overall" ? 1 : x.scope.localeCompare(y.scope)))
                      .map((s) => {
                        const flagged = failing.some((f) => f.rule.scope === s.scope && (f.rule.scopeId ?? null) === (s.scope_id ?? null));
                        return (
                          <span key={`${s.scope}:${s.scope_id}`} className={`rounded-md border px-2 py-1 text-xs ${flagged ? "border-warning bg-warning/15 font-semibold" : "border-border"}`}>
                            {scopeName(s.scope, s.scope_id)} {s.percent}% · {BAND_LABELS[s.band as BenchmarkBand] ?? s.band}
                          </span>
                        );
                      })}
                  </div>
                ) : null}
                {failing.length ? (
                  <ul className="mt-2 text-xs text-muted-foreground">
                    {failing.map((f, i) => (
                      <li key={i}>
                        <Badge variant={f.effect === "hard_fail" ? "destructive" : "warning"} className="mr-1">{f.effect === "unverifiable" ? "no score" : f.effect.replace("_", " ")}</Badge>
                        {f.rule.label}{f.actual !== null ? ` — actual ${f.actual}%` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canDecide ? (
                  <ActionForm action={recordDecision} label="Record decision" size="sm" className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <NativeSelect name="outcome" defaultValue="approved" className="h-9 w-40 md:h-9">
                      <option value="approved">Approve</option>
                      <option value="waitlisted">Waitlist</option>
                      <option value="declined">Decline</option>
                    </NativeSelect>
                    <Input name="reason" placeholder="Reason (required, recorded with the decision)" className="h-9 min-w-72 flex-1 md:h-9" required minLength={5} />
                  </ActionForm>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState>Nothing waiting for a decision.</EmptyState>
      )}
    </>
  );
}

export type { Json };
