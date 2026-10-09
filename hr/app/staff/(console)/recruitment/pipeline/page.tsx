import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { FlagChips, ScoreBadge } from "@/components/recruitment/badges";
import { formatDate } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { STAGE_LABELS } from "@/lib/recruitment/engine";
import { requireStaff } from "@/lib/staff/session";
import type { PipelineStage } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { moveStageAction } from "../actions";

const STAGES: PipelineStage[] = ["review", "shortlisted", "unsuccessful"];

const COLUMN_HINT: Record<PipelineStage, string> = {
  review: "New applications land here.",
  shortlisted: "Invite to interview, then offer and hire.",
  unsuccessful: "Not taken further. Kept for the retention period, then removed.",
};

const MOVES: Record<PipelineStage, { to: PipelineStage; label: string; notifyDefault: boolean }[]> = {
  review: [
    { to: "shortlisted", label: "Shortlist", notifyDefault: true },
    { to: "unsuccessful", label: "Unsuccessful", notifyDefault: false },
  ],
  shortlisted: [
    { to: "review", label: "Back to review", notifyDefault: false },
    { to: "unsuccessful", label: "Unsuccessful", notifyDefault: false },
  ],
  unsuccessful: [{ to: "review", label: "Back to review", notifyDefault: false }],
};

/**
 * The pipeline: three columns and nothing else. Cards are sorted by score,
 * highest first, with the flags beside the number so a high score with a red
 * flag cannot be mistaken for a clean one. Moving a card never emails anyone
 * unless the person ticks the box, so news that a place went elsewhere is
 * always somebody's deliberate click.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ vacancy?: string }> }) {
  const { vacancy } = await searchParams;
  const ctx = await requireStaff("hr.recruitment.read");
  const canMove = can(ctx.permissions, "hr.recruitment.write");

  const { data: vacancies } = await ctx.supabase.from("hr_vacancies").select("id, title, status").in("status", ["published", "closed"]).order("created_at", { ascending: false });
  let query = ctx.supabase
    .from("hr_applications")
    .select("id, reference, first_name, last_name, stage, score_total, score_available, score_flags, submitted_at, vacancy_id")
    .eq("status", "submitted");
  if (vacancy && /^[0-9a-f-]{36}$/.test(vacancy)) query = query.eq("vacancy_id", vacancy);
  const { data: apps } = await query.order("score_total", { ascending: false, nullsFirst: false }).limit(500);

  const ids = (apps ?? []).map((a) => a.id);
  const { data: refs } = ids.length ? await ctx.supabase.from("hr_reference_requests").select("application_id, status").in("application_id", ids) : { data: [] };
  const refCount = new Map<string, { in: number; total: number }>();
  for (const r of refs ?? []) {
    const c = refCount.get(r.application_id) ?? { in: 0, total: 0 };
    if (r.status !== "declined") c.total++;
    if (r.status === "received") c.in++;
    refCount.set(r.application_id, c);
  }
  const vacancyTitle = new Map((vacancies ?? []).map((v) => [v.id, v.title]));

  return (
    <>
      <PageTitle title="Pipeline" description="Review, shortlist or set aside. The score is out of 100 once everything is in; flags never change it.">
        <form method="get" className="flex items-center gap-2">
          <label htmlFor="vacancy" className="sr-only">
            Vacancy
          </label>
          <select id="vacancy" name="vacancy" defaultValue={vacancy ?? ""} className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
            <option value="">All vacancies</option>
            {(vacancies ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium hover:bg-muted">
            Show
          </button>
        </form>
      </PageTitle>

      {!apps?.length ? (
        <EmptyState>No sent applications yet{vacancy ? " for this vacancy" : ""}.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {STAGES.map((stage) => {
            const cards = apps.filter((a) => a.stage === stage);
            return (
              <section key={stage} aria-labelledby={`col-${stage}`} className="flex min-h-40 flex-col rounded-2xl bg-muted/60 p-3">
                <header className="px-1 pb-3">
                  <h2 id={`col-${stage}`} className="flex items-center justify-between font-semibold">
                    {STAGE_LABELS[stage]}
                    <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold tabular-nums">{cards.length}</span>
                  </h2>
                  <p className="text-xs text-muted-foreground">{COLUMN_HINT[stage]}</p>
                </header>
                <ul className="space-y-2">
                  {cards.map((a) => {
                    const r = refCount.get(a.id) ?? { in: 0, total: 0 };
                    return (
                      <li key={a.id} className={cn("rounded-xl border border-border/70 bg-card p-3 shadow-soft", stage === "unsuccessful" && "opacity-80")}>
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/staff/recruitment/applications/${a.id}`} className="min-w-0 rounded-md hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
                            <p className="truncate font-semibold">
                              {a.first_name} {a.last_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {vacancy ? a.reference : vacancyTitle.get(a.vacancy_id) ?? a.reference}
                            </p>
                          </Link>
                          <ScoreBadge total={a.score_total} available={a.score_available} />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                          Sent {formatDate(a.submitted_at)} · References {r.in}/{r.total}
                        </p>
                        {a.score_flags.length ? (
                          <div className="mt-2">
                            <FlagChips codes={a.score_flags.filter((f) => f !== "references_outstanding")} limit={3} />
                          </div>
                        ) : null}
                        {canMove ? (
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3">
                            {MOVES[stage].map((m) => (
                              <details key={m.to} className="group">
                                <summary className="inline-flex h-7 cursor-pointer list-none items-center rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted">{m.label}</summary>
                                <div className="mt-2 w-64 rounded-xl border border-border bg-popover p-3 shadow-lift">
                                  <ActionForm action={moveStageAction.bind(null, a.id)} label={`Move to ${STAGE_LABELS[m.to]}`} size="sm">
                                    <input type="hidden" name="to" value={m.to} />
                                    <input type="hidden" name="expected" value={stage} />
                                    {m.to === "unsuccessful" ? (
                                      <input name="reason" placeholder="Reason (for the record, not emailed)" className="h-8 w-full rounded-lg border border-input bg-card px-2 text-xs" />
                                    ) : null}
                                    {m.to !== "review" ? (
                                      <label className="flex items-center gap-2 text-xs">
                                        <input type="checkbox" name="notify" defaultChecked={m.notifyDefault} className="size-4 accent-[var(--primary)]" />
                                        Email the applicant now
                                      </label>
                                    ) : null}
                                  </ActionForm>
                                </div>
                              </details>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
