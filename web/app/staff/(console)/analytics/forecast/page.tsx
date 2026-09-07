import Link from "next/link";
import { FillBar, PctBar } from "@/components/staff/charts";
import { PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { FactRow } from "@/lib/analytics/breakdown";
import { pct } from "@/lib/analytics/breakdown";
import { forecast, historicalRates, OPEN_STAGES, type ForecastLine, type Stage } from "@/lib/analytics/forecast";
import { daysAgoDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

type Search = { year?: string; campus?: string };

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
 * Expected enrolments per campus and grade for an academic year, read as
 * a picture first: how full each class is expected to be against its
 * capacity, then the campus totals, then the numbers and the rates behind
 * them. Places already held are solid; the pipeline in flight, weighted by
 * how often each stage has led to enrolment, is the lighter part; the line
 * is the capacity. Nothing here is a model.
 */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("analytics.read");
  const [{ data: years }, { data: campuses }] = await Promise.all([
    supabase.from("academic_years").select("id, label, is_current, starts_on").order("starts_on", { ascending: false }).limit(6),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
  ]);
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
    .filter((cg) => !sp.campus || cg.campus_id === sp.campus)
    .map((cg) => ({ campus_id: cg.campus_id, grade_id: cg.grade_id, capacity: cg.capacity, campus_name: one(cg.campuses)?.name ?? "", grade_name: one(cg.grades)?.name ?? "", grade_sort: one(cg.grades)?.sort_order ?? 0 }));
  const rates = historicalRates((history ?? []) as FactRow[]);
  const lines = forecast((current ?? []) as FactRow[], rates, capacities);
  const anyDefault = OPEN_STAGES.some((s) => rates[s].source === "default");

  const sum = (ls: ForecastLine[]) => ls.reduce((t, l) => ({ committed: t.committed + l.committed, expected: t.expected + l.expected, capacity: t.capacity + (l.capacity ?? 0), inFlight: t.inFlight + OPEN_STAGES.reduce((n, s) => n + (l.pipeline[s] ?? 0), 0), needed: t.needed + (l.enquiriesNeeded ?? 0) }), { committed: 0, expected: 0, capacity: 0, inFlight: 0, needed: 0 });
  const totals = sum(lines);
  const byCampus = [...new Set(lines.map((l) => l.campus))].map((name) => ({ name, lines: lines.filter((l) => l.campus === name) })).map((c) => ({ ...c, t: sum(c.lines) }));
  const short = lines.filter((l) => l.fill !== null && l.fill < 0.7).sort((a, b) => (a.fill ?? 0) - (b.fill ?? 0));
  const round1 = (v: number) => Math.round(v * 10) / 10;

  return (
    <>
      <PageTitle title="Forecast" description={`Expected enrolments for ${year.label}: places already held, plus the pipeline in flight weighted by the last twelve months' conversion.`}>
        <Link href="/staff/analytics" className="text-sm underline">Analytics</Link>
      </PageTitle>
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <NativeSelect name="year" defaultValue={year.id} className="w-48">
          {(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}{y.is_current ? " (current)" : ""}</option>)}
        </NativeSelect>
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Show</Button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Capacity" value={totals.capacity || "—"} hint="places set under Grades" />
        <StatTile label="Places held" value={totals.committed} tone="success" hint={pct(totals.capacity ? totals.committed / totals.capacity : null) + " of capacity"} />
        <StatTile label="In the pipeline" value={totals.inFlight} tone="info" hint="applications not yet decided or closed" />
        <StatTile label="Expected enrolments" value={round1(totals.expected)} hint={pct(totals.capacity ? totals.expected / totals.capacity : null) + " projected fill"} />
        <StatTile label="Enquiries still needed" value={totals.needed} tone="warning" hint="to fill every class with a capacity" />
      </div>

      {lines.length ? (
        <>
          <section className="surface mb-6 p-4">
            <h2 className="mb-1 text-sm font-semibold">How full each class is expected to be</h2>
            <p className="mb-3 text-xs text-muted-foreground">Solid = places already held. Lighter = what the pipeline is expected to add. The line is the capacity; a class that would overflow turns amber.</p>
            <div className="space-y-5">
              {byCampus.map((c) => (
                <div key={c.name}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">{c.name}</h3>
                    <p className="text-xs tabular-nums text-muted-foreground">{c.t.committed} held · {round1(c.t.expected)} expected · {c.t.capacity ? `${pct(c.t.expected / c.t.capacity)} of ${c.t.capacity}` : "no capacity set"}</p>
                  </div>
                  <ul className="space-y-1.5">
                    {c.lines.map((l) => (
                      <li key={`${l.campusId}:${l.gradeId}`} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                        <span className="truncate">{l.grade}</span>
                        <FillBar committed={l.committed} expected={l.expected} capacity={l.capacity} />
                        <span className="w-40 text-right text-xs tabular-nums">
                          <span className="font-medium">{pct(l.fill)}</span>
                          <span className="text-muted-foreground"> · {l.committed}{l.capacity !== null ? ` of ${l.capacity}` : ""} held</span>
                          {l.lowConfidence ? <Badge variant="muted" className="ml-1">low confidence</Badge> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {short.length ? (
            <section className="surface mb-6 border-warning p-4">
              <h2 className="mb-1 text-sm font-semibold">Classes below 70% projected fill</h2>
              <p className="mb-3 text-xs text-muted-foreground">Where marketing effort would count most. &ldquo;Enquiries needed&rdquo; assumes the current enquiry-to-enrolment rate of {pct(rates.enquired.rate)}.</p>
              <ul className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                {short.map((l) => (
                  <li key={`${l.campusId}:${l.gradeId}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <span>{l.campus} · {l.grade}</span>
                    <span className="text-xs tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{pct(l.fill)}</span> · {l.enquiriesNeeded ?? "—"} enquiries needed</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <details className="surface mb-6 p-4">
            <summary className="cursor-pointer text-sm font-semibold">The numbers behind each class</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Campus · Grade</th>
                    <th className="px-3 py-2 text-right font-medium">Capacity</th>
                    <th className="px-3 py-2 text-right font-medium">Held</th>
                    <th className="px-3 py-2 text-right font-medium">Places left</th>
                    <th className="px-3 py-2 font-medium">In flight</th>
                    <th className="px-3 py-2 text-right font-medium">Expected</th>
                    <th className="px-3 py-2 text-right font-medium">Projected fill</th>
                    <th className="px-3 py-2 text-right font-medium">Enquiries needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={`${l.campusId}:${l.gradeId}`}>
                      <td className="px-3 py-2 font-medium">{l.campus} · {l.grade}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.capacity ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.committed}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.remaining ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{OPEN_STAGES.filter((s) => l.pipeline[s]).map((s) => `${STAGE_LABELS[s]} ${l.pipeline[s]}`).join(" · ") || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.expected}</td>
                      <td className="px-3 py-2 text-right"><span className="inline-flex justify-end"><PctBar value={l.fill} tone={l.fill !== null && l.fill < 0.7 ? "warning" : "success"} /></span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.enquiriesNeeded ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="surface mb-6 p-4">
            <summary className="cursor-pointer text-sm font-semibold">The conversion rates the forecast assumes</summary>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">
              How often an application that reached each stage in the last twelve months went on to enrol.
              {anyDefault ? " Rates marked “assumed” are defaults because fewer than twenty settled applications reached that stage; the lines they touch are marked low confidence." : ""}
            </p>
            <ul className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
              {OPEN_STAGES.map((s) => (
                <li key={s} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span>{STAGE_LABELS[s]} → enrolled</span>
                  <span className="flex items-center gap-2 text-xs">
                    <PctBar value={rates[s].rate} />
                    <span className="text-muted-foreground">{rates[s].source === "history" ? `${rates[s].sample} settled` : "assumed"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No active campus grades. Set capacities under Settings → Grades.</p>
      )}
    </>
  );
}
