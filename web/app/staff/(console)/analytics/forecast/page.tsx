import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { FactRow } from "@/lib/analytics/breakdown";
import { pct } from "@/lib/analytics/breakdown";
import { forecast, historicalRates, OPEN_STAGES, type Stage } from "@/lib/analytics/forecast";
import { daysAgoDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

type Search = { year?: string };

const STAGE_LABELS: Record<Stage, string> = {
  enquired: "Enquired",
  booked: "Booked",
  assessed: "Assessed",
  approved: "Approved",
  offered: "Offered",
  accepted: "Accepted",
  paid: "Paid",
  registering: "Registering",
  enrolled: "Enrolled",
  closed: "Closed",
};

/**
 * Expected enrolments per campus and grade for an academic year: places
 * already held, plus the pipeline in flight weighted by how often each
 * stage has led to enrolment over the trailing year. Every rate and its
 * sample size is shown; nothing here is a model.
 */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("analytics.read");
  const { data: years } = await supabase.from("academic_years").select("id, label, is_current, starts_on").order("starts_on", { ascending: false }).limit(6);
  const year = (years ?? []).find((y) => y.id === sp.year) ?? (years ?? []).find((y) => y.is_current) ?? years?.[0] ?? null;
  if (!year) return <PageTitle title="Forecast" description="No academic year is set up yet." />;

  const [{ data: current }, { data: history }, { data: campusGrades }] = await Promise.all([
    supabase.from("v_application_facts").select("*").eq("academic_year_id", year.id).limit(5000),
    supabase.from("v_application_facts").select("*").gte("enquired_at", `${daysAgoDateString(365)}T00:00:00+02:00`).limit(5000),
    supabase.from("campus_grades").select("campus_id, grade_id, capacity, campuses!inner(name, is_active), grades!inner(name, sort_order, is_active)").eq("is_active", true),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const capacities = (campusGrades ?? [])
    .filter((cg) => one(cg.campuses)?.is_active && one(cg.grades)?.is_active)
    .map((cg) => ({ campus_id: cg.campus_id, grade_id: cg.grade_id, capacity: cg.capacity, campus_name: one(cg.campuses)?.name ?? "", grade_name: one(cg.grades)?.name ?? "", grade_sort: one(cg.grades)?.sort_order ?? 0 }));
  const rates = historicalRates((history ?? []) as FactRow[]);
  const lines = forecast((current ?? []) as FactRow[], rates, capacities);
  const anyDefault = OPEN_STAGES.some((s) => rates[s].source === "default");
  const totals = lines.reduce((t, l) => ({ committed: t.committed + l.committed, expected: t.expected + l.expected, capacity: t.capacity + (l.capacity ?? 0) }), { committed: 0, expected: 0, capacity: 0 });

  return (
    <>
      <PageTitle title="Forecast" description={`Expected enrolments for ${year.label}, from the pipeline in flight and the last twelve months' conversion.`}>
        <Link href="/staff/analytics" className="text-sm underline">Analytics</Link>
      </PageTitle>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <NativeSelect name="year" defaultValue={year.id} className="w-48">
          {(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}{y.is_current ? " (current)" : ""}</option>)}
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Show</Button>
      </form>

      <p className="mb-3 text-sm text-muted-foreground">
        Committed = places already held (approved and beyond). Expected = enrolled + each application in flight × the rate at which its stage has led to enrolment.
        {anyDefault ? " Rates marked “assumed” come from defaults because fewer than twenty settled applications reached that stage in the last year; treat those lines as low confidence." : ""}
      </p>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {OPEN_STAGES.map((s) => (
          <span key={s} className="rounded-md border border-border bg-card px-2 py-1">
            {STAGE_LABELS[s]} → enrolled: <span className="font-medium tabular-nums">{pct(rates[s].rate)}</span>
            <span className="text-muted-foreground"> ({rates[s].source === "history" ? `${rates[s].sample} settled` : "assumed"})</span>
          </span>
        ))}
      </div>

      {lines.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Campus · Grade</th>
                <th className="px-3 py-2 text-right font-medium">Capacity</th>
                <th className="px-3 py-2 text-right font-medium">Committed</th>
                <th className="px-3 py-2 text-right font-medium">Places left</th>
                <th className="px-3 py-2 font-medium">In flight</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Projected fill</th>
                <th className="px-3 py-2 text-right font-medium">Enquiries still needed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={`${l.campusId}:${l.gradeId}`}>
                  <td className="px-3 py-2 font-medium">{l.campus} · {l.grade}{l.lowConfidence ? <Badge variant="muted" className="ml-2">low confidence</Badge> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.capacity ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.committed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.remaining ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {OPEN_STAGES.filter((s) => l.pipeline[s]).map((s) => `${STAGE_LABELS[s]} ${l.pipeline[s]}`).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.expected}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${l.fill !== null && l.fill < 0.7 ? "text-warning-foreground" : ""}`}>{pct(l.fill)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.enquiriesNeeded ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 text-xs">
              <tr>
                <td className="px-3 py-2 font-medium">All</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.capacity || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.committed}</td>
                <td />
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{Math.round(totals.expected * 10) / 10}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(totals.capacity ? totals.expected / totals.capacity : null)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No active campus grades. Set capacities under Set up → Grades.</p>
      )}
    </>
  );
}
