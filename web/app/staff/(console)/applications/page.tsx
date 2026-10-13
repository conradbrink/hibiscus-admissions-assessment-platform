import Link from "next/link";
import { AdmissionsHeader, loadAdmissionsHeaderData } from "@/components/staff/admissions-header";
import { FilterChips } from "@/components/staff/filter-chips";
import { EmptyState } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { isConversionStepKey, notConverted, NOT_CONVERTED_LABELS } from "@/lib/analytics/drill-down";
import type { FactRow } from "@/lib/analytics/breakdown";
import { readFacts } from "@/lib/analytics/facts";
import { resolveRange } from "@/lib/analytics/ranges";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/format-date";
import { formatMonth, startLabel } from "@/lib/start-month";
import { requireStaff } from "@/lib/staff/session";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { isNextAction, nextActionCopy, PIPELINE_GROUPS, STATUS_LABELS } from "@/lib/workflow/states";
import { isStageKey, OUTSIDE_STAGES, STAGES, stageOf } from "@/lib/workflow/stages";
import { FLAG_LABELS, type Flag } from "@/lib/summary/facts";
import { isScholarshipCode } from "@/lib/promotions/scholarship";

type Search = {
  q?: string;
  status?: string;
  /** One of the Admissions stages, from the stage bar. */
  stage?: string;
  /** The board's old column names, from before the stages: still honoured for a bookmark. */
  group?: string;
  campus?: string;
  /** `applications.intake_id` — the term a child is starting. */
  intake?: string;
  /** `applications.start_month`, for the campuses that take children monthly. */
  month?: string;
  mine?: string;
  page?: string;
  /** From the dashboard: only enquiries older than this ("48h"), the ones its count calls not booked. */
  waiting?: string;
  /** From the dashboard: deferred families due back on or before this date. */
  due_by?: string;
  /**
   * From analytics: the families a conversion step has not converted, among
   * those who enquired between `from` and `to`. Exactly the count analytics
   * showed beside the link.
   */
  step?: string;
  from?: string;
  to?: string;
};

const PAGE = 50;

/** The dashboard's narrowings, by what its count is: the list has to hold the same families. */
const WAITING: Record<string, { ms: number; words: string }> = {
  "48h": { ms: 48 * 3_600_000, words: "who enquired more than 48 hours ago" },
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("applications.read");

  const stage = isStageKey(sp.stage) ? STAGES.find((st) => st.key === sp.stage)! : undefined;
  const group = stage ? undefined : PIPELINE_GROUPS.find((g) => g.key === sp.group);
  const scope = stage ?? group;
  const statuses: ApplicationStatus[] | null = sp.status
    ? [sp.status as ApplicationStatus]
    : scope
      ? [...scope.statuses]
      : null;
  // The stage bar follows what is on screen: the stage asked for, or the one a
  // status belongs to (a link from the dashboard names only the status).
  const tab = stage?.key ?? (sp.status && !group ? stageOf(sp.status as ApplicationStatus) : null) ?? "all";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const now = new Date();
  const waiting = sp.waiting && Object.hasOwn(WAITING, sp.waiting) ? WAITING[sp.waiting] : undefined;
  const dueBy = sp.due_by && /^\d{4}-\d{2}-\d{2}$/.test(sp.due_by) ? sp.due_by : undefined;

  // A step from analytics is answered from the same facts analytics counted,
  // then the page of them is read here like any other row. The other filters
  // stand aside while it is on: anything they removed would make the list
  // disagree with the number that was clicked.
  const step = isConversionStepKey(sp.step) ? sp.step : null;
  const range = step ? resolveRange(sp.from, sp.to, now) : null;

  // The page's other reads do not depend on the step, so they start now
  // rather than waiting behind its facts.
  const others = Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    loadAdmissionsHeaderData(supabase, userId),
    supabase.from("intakes").select("id, label, starts_on").order("starts_on"),
    // The months children are actually starting, rather than every month a
    // calendar could offer: a filter for a month nobody is joining in is a
    // filter that always returns nothing.
    supabase.from("applications").select("start_month").not("start_month", "is", null),
  ]);

  let stepTotal = 0;
  let stepIds: string[] | null = null;
  if (step && range) {
    const { data: facts, error: factsError } = await readFacts(supabase, range, sp.campus);
    if (factsError) throw new Error(factsError.message);
    const ids = notConverted((facts ?? []) as FactRow[], step).map((r) => r.application_id);
    stepTotal = ids.length;
    stepIds = ids.slice((page - 1) * PAGE, page * PAGE);
  }

  let query = supabase
    .from("applications")
    .select(
      "id, reference, child_first_name, child_last_name, status, next_action, next_action_due_at, created_at, owner_staff_id, requires_assessment, start_month, campuses(name), grades!applications_grade_id_fkey(name), intakes!applications_intake_id_fkey(label), contacts!applications_contact_id_fkey(first_name, last_name, email), staff_profiles!applications_owner_staff_id_fkey(full_name)",
      // A step's total is already known from its facts.
      { count: stepIds ? undefined : "exact" }
    )
    .order("created_at", { ascending: false });
  if (stepIds) query = query.in("id", stepIds);
  else {
    query = query.range((page - 1) * PAGE, page * PAGE - 1);
    if (statuses) query = query.in("status", statuses);
    else query = query.neq("status", "withdrawn");
    if (waiting) query = query.lt("created_at", new Date(now.getTime() - waiting.ms).toISOString());
    if (dueBy) query = query.lte("deferred_until", dueBy);
    if (sp.campus) query = query.eq("campus_id", sp.campus);
    // Term and month compose rather than exclude each other: a campus that takes
    // children monthly still has them on a term, so "Term 1, 2027" and "March
    // 2027" together is a question somebody asks.
    if (sp.intake) query = query.eq("intake_id", sp.intake);
    if (sp.month) query = query.eq("start_month", sp.month);
    if (sp.mine === "1") query = query.eq("owner_staff_id", userId);
    if (sp.q) {
      const q = sp.q.trim();
      query = query.or(
        `reference.ilike.%${q}%,child_first_name.ilike.%${q}%,child_last_name.ilike.%${q}%`
      );
    }
  }

  const [{ data: rows, count, error }, [{ data: campuses }, header, { data: intakes }, { data: monthRows }]] = await Promise.all([query, others]);
  if (error) throw new Error(error.message);

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  // A step's page in the order analytics listed it, newest enquiry first.
  if (stepIds) {
    const order = new Map(stepIds.map((id, i) => [id, i]));
    rows?.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  // Attention flags from the last generated summary, where one exists, and
  // which of these children hold a scholarship — batched together, because a
  // row that says "Parent to book assessment" against a scholarship child is
  // the same wrong word the parent's own screen used to show.
  const ids = (rows ?? []).map((r) => r.id);
  const [{ data: summaries }, { data: awards }] = ids.length
    ? await Promise.all([
        supabase.from("application_summaries").select("application_id, flags").in("application_id", ids),
        supabase.from("application_promotions").select("application_id, promotions(code)").in("application_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const flagsFor = new Map<string, Flag[]>();
  for (const s of summaries ?? []) flagsFor.set(s.application_id, (Array.isArray(s.flags) ? s.flags : []) as unknown as Flag[]);
  const scholars = new Set(
    (awards ?? []).filter((a) => isScholarshipCode(one(a.promotions)?.code ?? null)).map((a) => a.application_id)
  );
  const chosenCampus = sp.campus ? (campuses ?? []).find((c) => c.id === sp.campus)?.name : undefined;
  const months = [...new Set((monthRows ?? []).map((r) => r.start_month).filter((m): m is string => Boolean(m)))].sort();
  const total = stepIds ? stepTotal : (count ?? 0);
  // The list's own filters, kept when moving between stages and to the
  // paused-or-closed lists: what a stage or status narrows, it narrows within.
  const listQuery = new URLSearchParams(
    Object.entries({ q: sp.q, campus: sp.campus, intake: sp.intake, month: sp.month, mine: sp.mine }).filter((e): e is [string, string] => Boolean(e[1]))
  ).toString();
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <AdmissionsHeader
        ctx={{ permissions }}
        data={header}
        stage={tab}
        view="list"
        listQuery={listQuery}
        description={`${total} ${total === 1 ? "applicant" : "applicants"}${stage ? ` in ${stage.label}` : ""}${sp.status && !step ? ` · ${STATUS_LABELS[sp.status as ApplicationStatus] ?? sp.status}` : ""}`}
      />

      {/* What a link from the dashboard or analytics narrowed the list to,
          said in words, with the way back to the whole list. Without it the
          list is shorter than the filters on screen explain. */}
      {step && range ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {sentence(NOT_CONVERTED_LABELS[step].many)}, from families who enquired {formatDateRange(range.from, range.to)}
          {chosenCampus ? ` at ${chosenCampus}` : ""}. The same families analytics counted.{" "}
          <Link href="/staff/applications" className="text-primary underline underline-offset-2">Show all applicants</Link>
        </p>
      ) : waiting || dueBy ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Only those {[waiting?.words, dueBy ? `due back by ${formatDate(dueBy)}` : null].filter(Boolean).join(" and ")}, as counted on the dashboard.{" "}
          <Link href={`/staff/applications${qs({ waiting: undefined, due_by: undefined, page: undefined })}`} className="text-primary underline underline-offset-2">Show them all</Link>
        </p>
      ) : null}

      {/* Paused and closed applications are in no stage. A family nobody can
          find is a family nobody comes back to, so All keeps a way to each. */}
      {tab === "all" && !group && !step ? (
        <FilterChips
          label="Not in a stage"
          caption="Paused or closed:"
          chips={OUTSIDE_STAGES.map((st) => ({
            label: STATUS_LABELS[st],
            href: `/staff/applications${qs({ status: st, stage: undefined, group: undefined, page: undefined })}`,
            active: sp.status === st,
            count: header.counts?.get(st),
          }))}
        />
      ) : null}

      {step ? null : <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {stage ? <input type="hidden" name="stage" value={stage.key} /> : null}
        {waiting ? <input type="hidden" name="waiting" value={sp.waiting} /> : null}
        {dueBy ? <input type="hidden" name="due_by" value={dueBy} /> : null}
        {group ? <input type="hidden" name="group" value={group.key} /> : null}
        <Input name="q" placeholder="Search name or reference" defaultValue={sp.q ?? ""} className="w-56" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="intake" defaultValue={sp.intake ?? ""} className="w-40">
          <option value="">Any term</option>
          {(intakes ?? []).map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="month" defaultValue={sp.month ?? ""} className="w-40">
          <option value="">Any month</option>
          {months.map((m) => (
            <option key={m} value={m}>{formatMonth(m)}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-52">
          <option value="">Any status{scope ? ` in ${scope.label}` : ""}</option>
          {(scope ? scope.statuses : (Object.keys(STATUS_LABELS) as ApplicationStatus[])).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </NativeSelect>
        <label className="flex h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> Mine
        </label>
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
      </form>}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Child</th>
                <th className="px-3 py-2 font-medium">Parent</th>
                <th className="px-3 py-2 font-medium">Campus · Grade</th>
                <th className="px-3 py-2 font-medium">Starting</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Next action</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Enquired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const campus = one(r.campuses);
                const grade = one(r.grades);
                const contact = one(r.contacts);
                const owner = one(r.staff_profiles);
                const intake = one(r.intakes);
                const na = isNextAction(r.next_action)
                  ? nextActionCopy(r.next_action, { requiresAssessment: r.requires_assessment, bookingKind: null, scholarship: scholars.has(r.id) }).staffLabel
                  : "—";
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link href={`/staff/applications/${r.id}`} className="font-medium hover:underline">
                        {r.child_first_name} {r.child_last_name}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">{r.reference}</span>
                    </td>
                    <td className="px-3 py-2">
                      {contact?.first_name} {contact?.last_name}
                      <span className="block text-xs text-muted-foreground">{contact?.email}</span>
                    </td>
                    <td className="px-3 py-2">{campus?.name} · {grade?.name}</td>
                    {/* The month where the campus takes children monthly, the
                        term otherwise — the same answer the applicant page and
                        the offer letter give, from the same helper. */}
                    <td className="px-3 py-2">
                      {intake ? startLabel(r, intake) : "—"}
                      {r.start_month && intake ? <span className="block text-xs text-muted-foreground">{intake.label}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                      {(flagsFor.get(r.id) ?? []).filter((f) => f.kind !== "waiting_on_school").length ? (
                        <span className="mt-1 block text-xs text-warning-foreground">
                          {(flagsFor.get(r.id) ?? []).filter((f) => f.kind !== "waiting_on_school").map((f) => FLAG_LABELS[f.kind] ?? f.kind).join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {na}
                      {r.next_action_due_at ? <span className="block text-xs text-muted-foreground">by {formatDateTime(r.next_action_due_at)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{owner?.full_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No applicants match.</EmptyState>
      )}

      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-3">
            {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="underline">Previous</Link> : null}
            {page < pages ? <Link href={qs({ page: String(page + 1) })} className="underline">Next</Link> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
