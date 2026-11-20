import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { daysAgoDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";
import { REPORTS, REPORT_KINDS, buildReport, displayCell, type ReportKind } from "@/lib/stores/reports";
import { schoolToday } from "@/lib/stores/server";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid";

type Search = { from?: string; to?: string; category?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One report: its filters, its table and its downloads. The table on screen
 * and the file are built by the same function, so they cannot disagree.
 */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Search> }) {
  const [{ kind }, sp] = await Promise.all([params, searchParams]);
  if (!REPORT_KINDS.includes(kind as ReportKind)) notFound();
  const k = kind as ReportKind;
  const { supabase } = await requireStaff("stores.read");
  const today = schoolToday();
  const def = REPORTS[k];
  const from = sp.from && DATE.test(sp.from) ? sp.from : k === "assigned" || k === "outstanding" ? "2000-01-01" : daysAgoDateString(30);
  const to = sp.to && DATE.test(sp.to) ? sp.to : today;
  const categories = await listNamed(supabase, "stores_categories");
  // A hand-typed or stale ?category= that is not an id is ignored, not sent
  // to the database to fail the whole report.
  const catId = isUuid(sp.category) ? sp.category : null;
  const category = k === "consumables" ? (categories.find((c) => c.id === catId)?.name ?? null) : catId;
  const report = await buildReport(supabase, k, { from, to, category }, today);
  const qs = new URLSearchParams({ kind: k, from, to, ...(catId ? { category: catId } : {}) }).toString();
  const usesCategory = k !== "outstanding" && k !== "overdue" && k !== "assigned";

  return (
    <>
      <PageTitle title={def.title} description={def.blurb} back={{ href: "/staff/stores/reports", label: "Reports" }}>
        <a href={`/staff/stores/reports/export?${qs}&format=xlsx`} className={buttonVariants({ variant: "outline", size: "lg" })}><Download aria-hidden /> Excel</a>
        <a href={`/staff/stores/reports/export?${qs}&format=csv`} className={buttonVariants({ variant: "outline", size: "lg" })}><Download aria-hidden /> CSV</a>
      </PageTitle>
      {def.dated || usesCategory ? (
        <form method="get" className="mb-4 grid gap-2 sm:flex sm:flex-wrap sm:items-end print:hidden">
          {def.dated ? (
            <>
              <label className="space-y-1 text-xs text-muted-foreground">{def.dateLabel} from<Input type="date" name="from" defaultValue={from === "2000-01-01" ? "" : from} max={today} /></label>
              <label className="space-y-1 text-xs text-muted-foreground">to<Input type="date" name="to" defaultValue={to} max={today} /></label>
            </>
          ) : null}
          {usesCategory ? (
            <label className="space-y-1 text-xs text-muted-foreground">Category
              <NativeSelect name="category" defaultValue={sp.category ?? ""}>
                <option value="">Every category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </label>
          ) : null}
          <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "h-11 md:h-9")}>Apply</button>
        </form>
      ) : null}
      {report.summary ? <p className="mb-3 text-sm text-muted-foreground">{report.summary}</p> : null}
      {report.rows.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead><tr>{report.columns.map((c) => <th key={c.label} className={cn(c.align === "right" && "text-right")}>{c.label}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => <td key={j} className={cn("whitespace-nowrap", report.columns[j].align === "right" && "text-right tabular-nums", j === 0 && "font-medium")}>{displayCell(cell, report.columns[j])}</td>)}
                </tr>
              ))}
            </tbody>
            {report.footer ? (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  {report.footer.map((cell, j) => <td key={j} className={cn("px-3 py-2.5", report.columns[j].align === "right" && "text-right tabular-nums")}>{cell === null ? "" : displayCell(cell, report.columns[j])}</td>)}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
        <EmptyState>Nothing to show for these filters.</EmptyState>
      )}
    </>
  );
}
