import Link from "next/link";
import { AreaHeader } from "@/components/staff/area-header";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { bookingKindsInScope, type ScopeKinds } from "@/lib/staff/scope";
import type { StaffContext } from "@/lib/staff/session";
import { STAGES, visibleViews, type StageKey, type StageView } from "@/lib/workflow/stages";

/** How many applications are in each status, as `v_pipeline_counts` answers for this person's campuses. */
export type StatusCounts = ReadonlyMap<string, number>;

/**
 * What the stage bar reads: the counts on its tabs, and whether this person's
 * campuses run assessments at all (a pre-school campus books visits, which the
 * check-in board does not list). `counts` is null when they could not be read,
 * and the tabs then go without numbers rather than show zeros that are not true.
 */
export type AdmissionsHeaderData = { counts: StatusCounts | null; kinds: ScopeKinds };

/**
 * Loads it. Pages start this before their own queries and hand over the
 * promise, so the two run side by side rather than one after the other. It
 * never rejects: a stage bar without numbers is better than no page.
 */
export async function loadAdmissionsHeaderData(supabase: StaffContext["supabase"], userId: string): Promise<AdmissionsHeaderData> {
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  try {
    const [pipeline, { data: mine }, { data: offered }] = await Promise.all([
      supabase.from("v_pipeline_counts").select("status, applications"),
      // The same reading of "what these campuses do" as the dashboard's.
      supabase.from("staff_campuses").select("campus_id").eq("staff_id", userId),
      supabase.from("campus_grades").select("campus_id, requires_assessment, grades!inner(requires_assessment)").eq("is_active", true),
    ]);
    let counts: Map<string, number> | null = null;
    if (!pipeline.error) {
      counts = new Map();
      for (const r of pipeline.data ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + r.applications);
    }
    const kinds = bookingKindsInScope(
      (offered ?? []).map((o) => ({
        campusId: o.campus_id,
        requiresAssessment: o.requires_assessment,
        gradeRequiresAssessment: one(o.grades)?.requires_assessment ?? false,
      })),
      (mine ?? []).map((r) => r.campus_id)
    );
    return { counts, kinds };
  } catch {
    return { counts: null, kinds: { assessment: true, visit: true } };
  }
}

/**
 * The screens of a stage this person may open, on the campuses they work at:
 * a scope that runs no assessments has nothing on the check-in board, so its
 * Assessment stage opens on the list.
 */
function viewsFor(permissions: StaffContext["permissions"], kinds: ScopeKinds, stage: StageKey | "all"): StageView[] {
  return visibleViews(permissions, stage).filter((v) => !(stage === "assessment" && v.key === "today" && !kinds.assessment));
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
  data,
  stage,
  view,
  listQuery,
  description,
  viewActions,
}: {
  ctx: Pick<StaffContext, "permissions">;
  data: AdmissionsHeaderData | Promise<AdmissionsHeaderData>;
  stage: StageKey | "all";
  /** The `key` of the screen on view, from `STAGE_VIEWS`. */
  view: string;
  /**
   * The applicant list's own filters (search, campus, term, month, mine), as a
   * query string, kept when moving between stages of the list.
   */
  listQuery?: string;
  description?: React.ReactNode;
  viewActions?: React.ReactNode;
}) {
  const { counts, kinds } = await data;
  const sum = (statuses: readonly string[]) => (counts ? statuses.reduce((n, s) => n + (counts.get(s) ?? 0), 0) : undefined);
  // "All" is everybody still in play, as the list under it shows: every status but withdrawn.
  const everyone = counts ? [...counts].reduce((n, [status, c]) => (status === "withdrawn" ? n : n + c), 0) : undefined;
  const carry = (href: string) => (listQuery && href.startsWith("/staff/applications") ? `${href}${href.includes("?") ? "&" : "?"}${listQuery}` : href);

  const tabs = [{ key: "all" as const, label: "All", count: everyone }, ...STAGES.map((s) => ({ key: s.key, label: s.label, count: sum(s.statuses) }))].flatMap((t) => {
    const first = viewsFor(ctx.permissions, kinds, t.key)[0];
    return first ? [{ label: t.label, href: carry(first.href), active: t.key === stage, count: t.count }] : [];
  });
  const views = viewsFor(ctx.permissions, kinds, stage).map((v) => ({ label: v.label, href: carry(v.href), active: v.key === view }));

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
