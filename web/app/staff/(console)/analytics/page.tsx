import Link from "next/link";
import { BarList, FunnelChart, Headline, PctBar } from "@/components/staff/charts";
import { PageTitle } from "@/components/staff/page-title";
import { TrendChart } from "@/components/staff/trend-chart";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import {
  conversion,
  cycleTimes,
  DIMENSION_LABELS,
  DIMENSIONS,
  fmtDays,
  funnelCounts,
  groupBy,
  parentEffort,
  pct,
  weeklySeries,
  type Dimension,
  type FactRow,
} from "@/lib/analytics/breakdown";
import { delta, funnelStages, headline, previousRange, shares } from "@/lib/analytics/compare";
import { daysAgoDateString, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

/**
 * Admissions analytics, read top to bottom: six headline figures with how
 * they moved against the period before; the funnel as a picture; where
 * families come from and how each group converts; the weekly trend; and
 * the detail (breakdown table, cycle times, parent effort) under it for
 * anyone who wants the numbers. All arithmetic is in lib/analytics and
 * tested; this page reads the facts view through RLS and draws.
 */
type Search = { from?: string; to?: string; campus?: string; dim?: string };

/** The eight enquiry fields: what a parent completes before the assessment. */
const ENQUIRY_FIELDS = 8;

function fmtSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

const fmtD = (v: number | null) => (v === null ? "—" : fmtDays(v));

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("analytics.read");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : toSchoolDateString(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : daysAgoDateString(90);
  const dim: Dimension = (DIMENSIONS as readonly string[]).includes(sp.dim ?? "") ? (sp.dim as Dimension) : "campus";
  const prev = previousRange(from, to);

  const facts = (range: { from: string; to: string }) => {
    let q = supabase.from("v_application_facts").select("*").gte("enquired_at", `${range.from}T00:00:00+02:00`).lte("enquired_at", `${range.to}T23:59:59+02:00`).limit(5000);
    if (sp.campus) q = q.eq("campus_id", sp.campus);
    return q;
  };

  const [{ data: rows }, { data: prevRows }, { data: effort }, { data: campuses }, { data: profiles }] = await Promise.all([
    facts({ from, to }),
    facts(prev),
    supabase.from("v_funnel_effort").select("*").maybeSingle(),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("learning_profiles").select("application_id, narrative_source, validation_status").not("published_at", "is", null).gte("created_at", `${from}T00:00:00+02:00`),
  ]);

  const all = (rows ?? []) as FactRow[];
  const before = (prevRows ?? []) as FactRow[];
  const now = headline(all);
  const then = headline(before);
  const counts = funnelCounts(all);
  const stages = funnelStages(counts);
  const conv = conversion(counts, all.filter((r) => r.requires_assessment).length);
  const cycle = cycleTimes(all);
  const prevCycle = cycleTimes(before);
  const groups = groupBy(all, dim);
  const heard = shares(groupBy(all, "heard_from"));
  const byCampus = shares(groupBy(all, "campus"));
  const byGrade = shares(groupBy(all, "grade"));
  const series = weeklySeries(all, from, to);
  const pe = parentEffort(all, ENQUIRY_FIELDS);
  const profileStats = {
    published: (profiles ?? []).length,
    ai: (profiles ?? []).filter((p) => p.narrative_source === "ai").length,
    fellBack: (profiles ?? []).filter((p) => p.validation_status === "failed").length,
  };
  const qs = new URLSearchParams({ from, to, ...(sp.campus ? { campus: sp.campus } : {}), dim }).toString();
  const campusName = sp.campus ? (campuses ?? []).find((c) => c.id === sp.campus)?.name : null;

  return (
    <>
      <PageTitle title="Analytics" description={`${campusName ?? "All campuses"} · enquiries from ${from} to ${to}, compared with ${prev.from} to ${prev.to}.`}>
        <Link href="/staff/analytics/forecast" className="text-sm underline">Forecast</Link>
      </PageTitle>
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <Input type="date" name="from" defaultValue={from} className="w-40" />
        <Input type="date" name="to" defaultValue={to} className="w-40" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="dim" defaultValue={dim} className="w-52">
          {DIMENSIONS.map((d) => <option key={d} value={d}>Break down by {DIMENSION_LABELS[d].toLowerCase()}</option>)}
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Apply</Button>
        {can(permissions, "data.export") ? (
          <a href={`/staff/analytics/export?${qs}`} className="text-sm text-primary underline underline-offset-2">Export CSV</a>
        ) : null}
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Headline label="Enquiries" value={now.enquiries} delta={delta(now.enquiries, then.enquiries)} />
        <Headline label="Enrolled" value={now.enrolled} delta={delta(now.enrolled, then.enrolled)} />
        <Headline label="Enquiry → enrolment" value={pct(now.enquiryToEnrolment)} delta={delta(now.enquiryToEnrolment, then.enquiryToEnrolment, "fraction")} kind="fraction" />
        <Headline label="Offers accepted" value={pct(now.offerAcceptance)} delta={delta(now.offerAcceptance, then.offerAcceptance, "fraction")} kind="fraction" hint="of offers sent" />
        <Headline label="No-show rate" value={pct(now.noShowRate)} delta={delta(now.noShowRate, then.noShowRate, "fraction")} kind="fraction" goodWhen="down" hint="of assessment bookings" />
        <Headline label="Enquiry → offer" value={fmtD(now.medianDaysToOffer)} delta={delta(now.medianDaysToOffer, then.medianDaysToOffer, "days")} kind="days" goodWhen="down" hint="median, adding each step" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="surface p-4">
          <h2 className="mb-1 text-sm font-semibold">The funnel</h2>
          <p className="mb-3 text-xs text-muted-foreground">Each bar is scaled to enquiries. The first percentage is the share of enquiries that reached the stage; the second is the conversion from the stage before.</p>
          <FunnelChart stages={stages} />
        </section>
        <section className="surface p-4">
          <h2 className="mb-1 text-sm font-semibold">Step conversion, now against before</h2>
          <p className="mb-3 text-xs text-muted-foreground">Where the pipeline gains or loses families, and whether that improved.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 font-medium">Step</th><th className="py-1 text-right font-medium">This period</th><th className="py-1 text-right font-medium">Before</th><th className="py-1 text-right font-medium">Change</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Enquiry → booking", conv.enquiryToBooking, conversion(funnelCounts(before), before.filter((r) => r.requires_assessment).length).enquiryToBooking],
                ["Booking → attended", conv.bookingToAttendance, conversion(funnelCounts(before), 0).bookingToAttendance],
                ["Decisions approved", conv.approvalRate, conversion(funnelCounts(before), 0).approvalRate],
                ["Offer → accepted", conv.offerToAcceptance, conversion(funnelCounts(before), 0).offerToAcceptance],
                ["Accepted → paid", conv.acceptanceToPayment, conversion(funnelCounts(before), 0).acceptanceToPayment],
                ["Paid → enrolled", conv.paymentToEnrolment, conversion(funnelCounts(before), 0).paymentToEnrolment],
              ].map(([label, cur, prv]) => {
                const d = delta(cur as number | null, prv as number | null, "fraction");
                return (
                  <tr key={label as string}>
                    <td className="py-1.5">{label as string}</td>
                    <td className="py-1.5 text-right"><span className="inline-flex justify-end"><PctBar value={cur as number | null} /></span></td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{pct(prv as number | null)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${d?.direction === "up" ? "text-success" : d?.direction === "down" ? "text-destructive" : "text-muted-foreground"}`}>
                      {d ? (d.direction === "flat" ? "—" : `${d.direction === "up" ? "+" : "−"}${Math.round(Math.abs(d.abs) * 100)} pts`) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <section className="surface p-4">
          <h2 className="mb-1 text-sm font-semibold">Where families heard about us</h2>
          <p className="mb-3 text-xs text-muted-foreground">Share of enquiries, and how well each source converts to enrolment.</p>
          {heard.length ? <BarList rows={heard} /> : <p className="text-sm text-muted-foreground">Nothing in range.</p>}
        </section>
        <section className="surface p-4">
          <h2 className="mb-1 text-sm font-semibold">By campus</h2>
          <p className="mb-3 text-xs text-muted-foreground">Share of enquiries per campus.</p>
          {byCampus.length ? <BarList rows={byCampus} /> : <p className="text-sm text-muted-foreground">Nothing in range.</p>}
        </section>
        <section className="surface p-4">
          <h2 className="mb-1 text-sm font-semibold">By grade</h2>
          <p className="mb-3 text-xs text-muted-foreground">Which grades the demand is in.</p>
          {byGrade.length ? <BarList rows={byGrade} /> : <p className="text-sm text-muted-foreground">Nothing in range.</p>}
        </section>
      </div>

      <section className="surface mb-6 p-4 text-sm">
        <h2 className="mb-1 text-sm font-semibold">Week by week</h2>
        <p className="mb-3 text-xs text-muted-foreground">Enquiries received and enrolments confirmed in each week of the period.</p>
        <TrendChart series={series} />
      </section>

      <details className="surface mb-6 p-4" open>
        <summary className="cursor-pointer text-sm font-semibold">Breakdown by {DIMENSION_LABELS[dim].toLowerCase()}</summary>
        {groups.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{DIMENSION_LABELS[dim]}</th>
                  {["Enquiries", "Booked", "Attended", "No-shows", "Approved", "Offered", "Accepted", "Paid", "Enrolled"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Offer → accepted</th>
                  <th className="px-3 py-2 text-right font-medium">Enquiry → enrolment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.map((g) => (
                  <tr key={g.key}>
                    <td className="px-3 py-2 font-medium">{g.label}</td>
                    {[g.counts.enquiries, g.counts.bookings, g.counts.attended, g.counts.noShows, g.counts.approved, g.counts.offered, g.counts.accepted, g.counts.paid, g.counts.enrolled].map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums">{v}</td>
                    ))}
                    <td className="px-3 py-2 text-right"><span className="inline-flex justify-end"><PctBar value={g.counts.offered ? g.counts.accepted / g.counts.offered : null} tone="success" /></span></td>
                    <td className="px-3 py-2 text-right"><span className="inline-flex justify-end"><PctBar value={g.enquiryToEnrolment} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No applications in range.</p>
        )}
      </details>

      <details className="surface mb-6 p-4">
        <summary className="cursor-pointer text-sm font-semibold">How long each step takes, and how much a parent has to do</summary>
        <div className="mt-3 grid gap-6 lg:grid-cols-2 text-sm">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Median days per step (before, in grey)</h3>
            <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5">
              {[
                ["Enquiry → booking", cycle.enquiryToBooking, prevCycle.enquiryToBooking],
                ["Booking → assessment", cycle.bookingToAssessment, prevCycle.bookingToAssessment],
                ["Assessment → decision", cycle.assessmentToDecision, prevCycle.assessmentToDecision],
                ["Decision → offer", cycle.decisionToOffer, prevCycle.decisionToOffer],
                ["Offer → acceptance", cycle.offerToAcceptance, prevCycle.offerToAcceptance],
                ["Acceptance → payment", cycle.acceptanceToPayment, prevCycle.acceptanceToPayment],
                ["Payment → enrolment", cycle.paymentToEnrolment, prevCycle.paymentToEnrolment],
              ].map(([label, cur, prv]) => (
                <div key={label as string} className="contents">
                  <dt className="text-muted-foreground">{label as string}</dt>
                  <dd className="text-right tabular-nums">{fmtD(cur as number | null)}</dd>
                  <dd className="text-right tabular-nums text-muted-foreground">{fmtD(prv as number | null)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Parent effort</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Median time to enquire</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.median_seconds_to_enquiry)}</dd>
              <dt className="text-muted-foreground">Median time to a booking</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.median_seconds_to_booking)}</dd>
              <dt className="text-muted-foreground">Slowest tenth to a booking</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.p90_seconds_to_booking)}</dd>
              <dt className="text-muted-foreground">Fields before the assessment</dt><dd className="text-right tabular-nums">{pe.fieldsBeforeAssessment}</dd>
              <dt className="text-muted-foreground">Started but never enquired</dt><dd className="text-right tabular-nums">{pct(effort && effort.sessions_started ? 1 - effort.enquiries_submitted / effort.sessions_started : null)}</dd>
              <dt className="text-muted-foreground">Enquired but never booked</dt><dd className="text-right tabular-nums">{pct(pe.bookingAbandonment)}</dd>
              <dt className="text-muted-foreground">Entered by staff, not the parent</dt><dd className="text-right tabular-nums">{pct(pe.staffAssisted)}</dd>
              <dt className="text-muted-foreground">Messages per applicant</dt><dd className="text-right tabular-nums">{pe.messagesPerApplicant === null ? "—" : pe.messagesPerApplicant.toFixed(1)}</dd>
              <dt className="text-muted-foreground">Registration already filled in</dt><dd className="text-right tabular-nums">{pct(pe.prefilledAtRegistration)}</dd>
              <dt className="text-muted-foreground">Learning profiles published</dt><dd className="text-right tabular-nums">{profileStats.published} ({pct(profileStats.published ? profileStats.ai / profileStats.published : null)} with an AI narrative, {profileStats.fellBack} rejected by the validator)</dd>
            </dl>
          </div>
        </div>
      </details>
    </>
  );
}
