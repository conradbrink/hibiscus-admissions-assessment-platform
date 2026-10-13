import Link from "next/link";
import { AreaHeader } from "@/components/staff/area-header";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import type { StaffContext } from "@/lib/staff/session";
import { STAGES, visibleViews, type StageKey } from "@/lib/workflow/stages";

/** How many applications are in each status, as `v_pipeline_counts` answers for this person's campuses. */
export type StatusCounts = ReadonlyMap<string, number>;

export async function loadStatusCounts(supabase: StaffContext["supabase"]): Promise<StatusCounts> {
  const { data } = await supabase.from("v_pipeline_counts").select("status, applications");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + r.applications);
  return counts;
}

/**
 * The top of every Admissions page: the stage bar (All, New, Assessment,
 * Decision, Offer, Enrolment, Completed, each with how many are in it), the
 * screens of the stage on view, and Add applicant. A stage opens on the
 * first of its screens this person may see; one they may see none of is not
 * offered.
 */
export async function AdmissionsHeader({
  ctx,
  stage,
  view,
  counts,
  description,
  viewActions,
}: {
  ctx: Pick<StaffContext, "supabase" | "permissions">;
  stage: StageKey | "all";
  /** The `key` of the screen on view, from `STAGE_VIEWS`. */
  view: string;
  /** Pass them when the page has already loaded them; otherwise they are loaded here. */
  counts?: StatusCounts;
  description?: React.ReactNode;
  viewActions?: React.ReactNode;
}) {
  const byStatus = counts ?? (await loadStatusCounts(ctx.supabase));
  const sum = (statuses: readonly string[]) => statuses.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0);
  // "All" is everybody still in play, as the list under it shows: every status but withdrawn.
  const everyone = [...byStatus].reduce((n, [status, c]) => (status === "withdrawn" ? n : n + c), 0);

  const tabs = [{ key: "all" as const, label: "All", count: everyone }, ...STAGES.map((s) => ({ key: s.key, label: s.label, count: sum(s.statuses) }))].flatMap((t) => {
    const first = visibleViews(ctx.permissions, t.key)[0];
    return first ? [{ label: t.label, href: first.href, active: t.key === stage, count: t.count }] : [];
  });
  const views = visibleViews(ctx.permissions, stage).map((v) => ({ label: v.label, href: v.href, active: v.key === view }));

  return (
    <AreaHeader
      title="Admissions"
      tabsLabel="Stages"
      tabs={tabs}
      views={views}
      description={description}
      viewActions={viewActions}
      actions={
        // Adding a family by hand is a write; someone with read-only access
        // sees the stages without the button.
        can(ctx.permissions, "applications.write") ? (
          <Link href="/staff/applications/new" className={buttonVariants({ size: "lg" })}>
            Add applicant
          </Link>
        ) : null
      }
    />
  );
}
