import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { AdmissionsHeader, loadAdmissionsHeaderData } from "@/components/staff/admissions-header";
import { FilterChips } from "@/components/staff/filter-chips";
import { EmptyState } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { contactAge, describeList, listFilters, listQuery, loadListExtras, readDrill, toLine, type ListSearch } from "@/lib/applicant-list";
import type { FactRow } from "@/lib/analytics/breakdown";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { can, canAccessPath } from "@/lib/permissions";
import { formatMonth } from "@/lib/start-month";
import { requireStaff } from "@/lib/staff/session";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { STATUS_LABELS } from "@/lib/workflow/states";
import { OUTSIDE_STAGES, stageOf } from "@/lib/workflow/stages";

const PAGE = 50;

/** The query string's own values, without the page: a download is of the whole list. */
function pick(sp: ListSearch): Record<string, string> {
  return Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && e[0] !== "page"));
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<ListSearch> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("applications.read");

  // What the query string asks for, read once by the same function the
  // downloads use, so a file is always of the list it was taken from.
  const now = new Date();
  const f = listFilters(sp, now);
  const { stage, group, drill, range } = f;
  // The stage bar follows what is on screen: the stage asked for, or the one a
  // status belongs to (a link from the dashboard names only the status).
  const tab = stage?.key ?? (f.status && !group ? stageOf(f.status) : null) ?? "all";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  // The page's other reads do not depend on the drill, so they start now
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

  // A drill from analytics is answered from the same facts analytics counted,
  // then the page of them is read here like any other row.
  let drillTotal = 0;
  let drillIds: string[] | null = null;
  let facts: FactRow[] = [];
  if (drill) {
    const read = await readDrill(supabase, f);
    facts = read.facts;
    drillTotal = read.ids.length;
    drillIds = read.ids.slice((page - 1) * PAGE, page * PAGE);
  }

  // A drill's total is already known from its facts.
  const base = listQuery(supabase, f, userId, { count: !drillIds });
  const query = drillIds ? base.in("id", drillIds) : base.range((page - 1) * PAGE, page * PAGE - 1);

  const [{ data: rows, count, error }, [{ data: campuses }, header, { data: intakes }, { data: monthRows }]] = await Promise.all([query, others]);
  if (error) throw new Error(error.message);

  // A drill's page in the order analytics listed it, newest enquiry first.
  if (drillIds) {
    const order = new Map(drillIds.map((id, i) => [id, i]));
    rows?.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  const extras = await loadListExtras(supabase, (rows ?? []).map((r) => r.id));
  const lines = (rows ?? []).map((r) => toLine(r, extras));
  const chosenCampus = sp.campus ? (campuses ?? []).find((c) => c.id === sp.campus)?.name : undefined;
  const months = [...new Set((monthRows ?? []).map((r) => r.start_month).filter((m): m is string => Boolean(m)))].sort();
  const total = drillIds ? drillTotal : (count ?? 0);
  // The list's own filters, kept when moving between stages and to the
  // paused-or-closed lists: what a stage or status narrows, it narrows within.
  const listQueryString = new URLSearchParams(
    Object.entries({ q: sp.q, campus: sp.campus, intake: sp.intake, month: sp.month, mine: sp.mine }).filter((e): e is [string, string] => Boolean(e[1]))
  ).toString();
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const qs = (patch: Partial<ListSearch>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  // The whole list, not the page on screen, as a spreadsheet or a printable
  // report: the same query string, read by the same filters. A management
  // power of its own (`applications.export`), ticked per role under Staff &
  // roles, because a list of families is personal data leaving the system.
  const downloads =
    can(permissions, "applications.export") && total > 0 ? (
      <span className="flex items-center gap-1">
        {(["xlsx", "pdf"] as const).map((format) => (
          <a
            key={format}
            href={`/staff/applications/export?${new URLSearchParams({ ...pick(sp), format })}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={`Download all ${total} as ${format === "xlsx" ? "an Excel workbook" : "a PDF"}`}
          >
            {format === "xlsx" ? <FileSpreadsheet className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
            {format === "xlsx" ? "Excel" : "PDF"}
          </a>
        ))}
      </span>
    ) : null;

  return (
    <>
      <AdmissionsHeader
        ctx={{ permissions }}
        data={header}
        stage={tab}
        view="list"
        listQuery={listQueryString}
        description={`${total} ${total === 1 ? "applicant" : "applicants"}${stage ? ` in ${stage.label}` : ""}${f.status && !drill ? ` · ${STATUS_LABELS[f.status]}` : ""}`}
        viewActions={downloads}
      />

      {/* What a link from the dashboard or analytics narrowed the list to,
          said in words, with the way back to the whole list. Without it the
          list is shorter than the filters on screen explain. */}
      {drill && range ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {describeList(f, { campus: chosenCampus, facts })}. The same families analytics counted.{" "}
          <Link href="/staff/applications" className="text-primary underline underline-offset-2">Show all applicants</Link>
          {canAccessPath(permissions, "/staff/analytics") ? (
            <>
              {" · "}
              <Link
                href={`/staff/analytics?${new URLSearchParams({ from: range.from, to: range.to, ...(sp.campus ? { campus: sp.campus } : {}) })}`}
                className="text-primary underline underline-offset-2"
              >
                Back to analytics
              </Link>
            </>
          ) : null}
        </p>
      ) : f.waiting || f.dueBy ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Only those {[f.waiting?.words, f.dueBy ? `due back by ${formatDate(f.dueBy)}` : null].filter(Boolean).join(" and ")}, as counted on the dashboard.{" "}
          <Link href={`/staff/applications${qs({ waiting: undefined, due_by: undefined, page: undefined })}`} className="text-primary underline underline-offset-2">Show them all</Link>
        </p>
      ) : null}

      {/* Paused and closed applications are in no stage. A family nobody can
          find is a family nobody comes back to, so All keeps a way to each. */}
      {tab === "all" && !group && !drill ? (
        <FilterChips
          label="Not in a stage"
          caption="Paused or closed:"
          chips={OUTSIDE_STAGES.map((st) => ({
            label: STATUS_LABELS[st],
            href: `/staff/applications${qs({ status: st, stage: undefined, group: undefined, page: undefined })}`,
            active: f.status === st,
            count: header.counts?.get(st),
          }))}
        />
      ) : null}

      {drill ? null : <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {stage ? <input type="hidden" name="stage" value={stage.key} /> : null}
        {f.waiting ? <input type="hidden" name="waiting" value={sp.waiting} /> : null}
        {f.dueBy ? <input type="hidden" name="due_by" value={f.dueBy} /> : null}
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
        <NativeSelect name="status" defaultValue={f.status ?? ""} className="w-52">
          <option value="">Any status{(stage ?? group) ? ` in ${(stage ?? group)!.label}` : ""}</option>
          {((stage ?? group)?.statuses ?? (Object.keys(STATUS_LABELS) as ApplicationStatus[])).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </NativeSelect>
        <label className="flex h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={f.mine} /> Mine
        </label>
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
      </form>}

      {lines.length > 0 ? (
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
                <th className="px-3 py-2 font-medium">Last contacted</th>
                <th className="px-3 py-2 font-medium">Enquired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const age = contactAge(l.lastContactAt, now);
                return (
                  <tr key={l.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link href={`/staff/applications/${l.id}`} className="font-medium hover:underline">
                        {l.childFirstName} {l.childLastName}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">{l.reference}</span>
                    </td>
                    <td className="px-3 py-2">
                      {l.parentName}
                      <span className="block text-xs text-muted-foreground">{l.parentEmail}</span>
                    </td>
                    <td className="px-3 py-2">{l.campus} · {l.grade}</td>
                    <td className="px-3 py-2">
                      {l.starting}
                      {l.term ? <span className="block text-xs text-muted-foreground">{l.term}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={l.status} />
                      {l.attention.length ? <span className="mt-1 block text-xs text-warning-foreground">{l.attention.join(" · ")}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {l.nextAction}
                      {l.nextActionDueAt ? <span className="block text-xs text-muted-foreground">by {formatDateTime(l.nextActionDueAt)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{l.owner ?? "—"}</td>
                    {/* When the school and the family last spoke, so a manager
                        can see who has gone quiet; a fortnight or more is marked. */}
                    <td className="px-3 py-2 whitespace-nowrap" title={l.lastContactAt ? formatDateTime(l.lastContactAt) : "No message or logged contact yet"}>
                      <span className={age.quiet ? "font-medium text-warning-foreground" : "text-foreground"}>{age.words}</span>
                      {l.lastContactAt ? <span className="block text-xs text-muted-foreground">{formatDate(l.lastContactAt)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(l.enquiredAt)}</td>
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
