import Link from "next/link";
import { ArrowRight, ChevronRight, Download } from "lucide-react";
import { BarList, FunnelChart, fmtCount, Headline, PctBar, StepList } from "@/components/staff/charts";
import { PageTitle } from "@/components/staff/page-title";
import { ParamSelect } from "@/components/staff/param-select";
import { TrendChart } from "@/components/staff/trend-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
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
import { conversionSteps, deferredSummary, delta, funnelStages, headline, previousRange, shares, weakestStep, type ConversionStepKey } from "@/lib/analytics/compare";
import { activePreset, RANGE_PRESETS, rangeFor, resolveRange } from "@/lib/analytics/ranges";
import { formatDateRange, toSchoolDateString } from "@/lib/format-date";
import { can, canAccessPath } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";

/**
 * Admissions analytics, read top to bottom: six headline figures with how
 * they moved against the period before; the funnel, and beside it the step
 * where families are lost, with the weakest one marked; then where families
 * come from, the weekly trend, and the detail (breakdown table, cycle times,
 * parent effort) folded away for anyone who wants the numbers. All
 * arithmetic is in lib/analytics and tested; this page reads the facts view
 * through RLS and draws.
 */
type Search = { from?: string; to?: string; campus?: string; dim?: string };

/** The eight enquiry fields: what a parent completes before the assessment. */
const ENQUIRY_FIELDS = 8;

/** The one surface every panel on this page shares: white, a hairline, almost no shadow. */
const PANEL = "rounded-lg border border-border/80 bg-card shadow-xs";

function fmtSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

const fmtD = (v: number | null) => (v === null ? "—" : fmtDays(v));

/**
 * Where to look at the families a step is losing: the applicant list,
 * filtered to the status or group a family sits in until they take that
 * step. The list shows where families are today rather than the period on
 * screen, so the words say what they will find, not how many.
 */
function drillDowns(campus: string | undefined): Record<ConversionStepKey, { href: string; label: string }> {
  const list = (filter: Record<string, string>) => `/staff/applications?${new URLSearchParams({ ...filter, ...(campus ? { campus } : {}) })}`;
  return {
    enquiryToBooking: { href: list({ group: "enquiry" }), label: "See open enquiries" },
    bookingToAttendance: { href: list({ status: "no_show" }), label: "See no-shows" },
    approvalRate: { href: list({ group: "outcome" }), label: "See decision outcomes" },
    offerToAcceptance: { href: list({ status: "offer_sent" }), label: "See offers awaiting a reply" },
    acceptanceToPayment: { href: list({ status: "payment_required" }), label: "See accepted offers not yet paid" },
    paymentToEnrolment: { href: list({ status: "registration_incomplete" }), label: "See unfinished registrations" },
  };
}

function SectionHeading({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 id={id} className="text-base font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** One segment of the period control; the chosen one is filled, the rest are quiet. */
function segment(active: boolean) {
  return cn(
    "flex h-6.5 cursor-pointer items-center rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active ? "bg-primary font-medium text-primary-foreground shadow-xs" : "text-muted-foreground hover:bg-muted hover:text-foreground"
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("analytics.read");
  const today = new Date();
  const { from, to } = resolveRange(sp.from, sp.to, today);
  const chosen = activePreset(from, to, today);
  const dim: Dimension = (DIMENSIONS as readonly string[]).includes(sp.dim ?? "") ? (sp.dim as Dimension) : "campus";
  const prev = previousRange(from, to);

  const facts = (range: { from: string; to: string }) => {
    let q = supabase.from("v_application_facts").select("*").gte("enquired_at", `${range.from}T00:00:00+02:00`).lte("enquired_at", `${range.to}T23:59:59+02:00`).limit(5000);
    if (sp.campus) q = q.eq("campus_id", sp.campus);
    return q;
  };

  const [{ data: rows, error: rowsError }, { data: prevRows, error: prevError }, { data: effort }, { data: campuses }, { data: profiles, error: profilesError }] = await Promise.all([
    facts({ from, to }),
    facts(prev),
    supabase.from("v_funnel_effort").select("*").maybeSingle(),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("learning_profiles").select("application_id, narrative_source, validation_status").not("published_at", "is", null).gte("created_at", `${from}T00:00:00+02:00`),
  ]);

  const chosenCampus = sp.campus ? (campuses ?? []).find((c) => c.id === sp.campus) : undefined;
  // A campus missing from the list (archived, or the list did not load) still
  // has its name on its own rows; only one with neither is "not available".
  // Offered in the select either way, so "All campuses" is a change to make.
  const campusListed = !sp.campus || Boolean(chosenCampus);
  const campusName = sp.campus ? (chosenCampus?.name ?? (rows as FactRow[] | null)?.[0]?.campus_name ?? "Campus not available") : null;
  // The links keep the campus and, once somebody has chosen one, the breakdown.
  const keep = { ...(sp.campus ? { campus: sp.campus } : {}), ...(sp.dim ? { dim } : {}) };

  const header = (
    <PageTitle
      title="Admissions analytics"
      description={`${campusName ?? "All campuses"} · families who enquired ${formatDateRange(from, to)}${prevError ? ". The period before could not be read, so nothing is compared." : `, compared with ${formatDateRange(prev.from, prev.to)}.`}`}
    >
      {can(permissions, "data.export") ? (
        <a
          href={`/staff/analytics/export?${new URLSearchParams({ from, to, ...(sp.campus ? { campus: sp.campus } : {}), dim })}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </a>
      ) : null}
      <Link href="/staff/analytics/forecast" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10">
        Forecast
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </PageTitle>
  );

  const toolbar = (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {(campuses ?? []).length > 1 || !campusListed ? (
        <ParamSelect
          name="campus"
          label="Campus"
          value={sp.campus ?? ""}
          options={[
            { value: "", label: "All campuses" },
            ...(campuses ?? []).map((c) => ({ value: c.id, label: c.name })),
            ...(campusListed ? [] : [{ value: sp.campus!, label: campusName ?? "Campus not available" }]),
          ]}
          className="h-8 w-44 rounded-lg py-0 text-[13px] md:h-8 md:text-[13px]"
        />
      ) : null}
      <nav aria-label="Period" className="relative flex flex-wrap items-center gap-0.5 rounded-lg border border-border/80 bg-card p-0.5 shadow-xs">
        {RANGE_PRESETS.map((p) => {
          const r = rangeFor(p, today);
          return (
            <Link
              key={p.key}
              href={`/staff/analytics?${new URLSearchParams({ from: r.from, to: r.to, ...keep })}`}
              aria-current={chosen === p.key ? "page" : undefined}
              aria-label={p.label}
              className={segment(chosen === p.key)}
            >
              {/* Narrow widths drop the repeated "Past" so the control stays on
                  one line; the full name is still the link's accessible name. */}
              <span className="@3xl:hidden">{p.label.replace(/^Past (\w)/, (_, c: string) => c.toUpperCase())}</span>
              <span className="hidden @3xl:inline">{p.label}</span>
            </Link>
          );
        })}
        {/* The dates open under the right end of the control, which is
            always inside the page, wherever "Custom" has wrapped to. */}
        <details>
          <summary className={cn(segment(chosen === null), "list-none [&::-webkit-details-marker]:hidden")} aria-current={chosen === null ? "page" : undefined}>
            Custom
          </summary>
          <form method="get" className="absolute top-full right-0 z-20 mt-2 w-64 space-y-3 rounded-lg border border-border bg-card p-3 shadow-lg">
            {sp.campus ? <input type="hidden" name="campus" value={sp.campus} /> : null}
            {sp.dim ? <input type="hidden" name="dim" value={dim} /> : null}
            <label className="block text-xs font-medium text-muted-foreground">
              From
              <Input type="date" name="from" defaultValue={from} className="mt-1" />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              To
              <Input type="date" name="to" defaultValue={to} className="mt-1" />
            </label>
            <Button type="submit" size="lg" className="w-full">Show these dates</Button>
          </form>
        </details>
      </nav>
    </div>
  );

  if (rowsError) {
    return (
      <>
        {header}
        <div className="@container">
          {toolbar}
          <section className={cn(PANEL, "border-destructive/30 p-5")}>
            <h2 className="mb-1 text-sm font-semibold text-destructive">These numbers could not be worked out</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              The figures are left out rather than shown as zero, because zero would not be true. A shorter range usually
              goes through, so try the past week or past month above. If it keeps happening, this is worth reporting.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Reason given: {rowsError.message}</p>
          </section>
        </div>
      </>
    );
  }

  const all = (rows ?? []) as FactRow[];
  // A failed read of the period before is no comparison, never a period of zeros.
  const before = prevError ? null : ((prevRows ?? []) as FactRow[]);
  const now = headline(all);
  const then = before ? headline(before) : null;
  const counts = funnelCounts(all);
  const stages = funnelStages(counts);
  const assessedNow = all.filter((r) => r.requires_assessment).length;
  const steps = conversionSteps(
    { counts, assessed: assessedNow },
    before ? { counts: funnelCounts(before), assessed: before.filter((r) => r.requires_assessment).length } : null
  );
  const weakest = weakestStep(steps);
  const weakestDetail = steps.find((s) => s.key === weakest) ?? null;
  // Ninety days is "soon enough to matter for the intake being planned", and
  // the same window the page already defaults to looking back over.
  const deferred = deferredSummary(all, toSchoolDateString(new Date(today.getTime() + 90 * 86_400_000)));
  const cycle = cycleTimes(all);
  const prevCycle = before ? cycleTimes(before) : null;
  const groups = groupBy(all, dim);
  const heard = shares(groupBy(all, "heard_from"));
  const byCampus = shares(groupBy(all, "campus"));
  const byGrade = shares(groupBy(all, "grade"));
  const series = weeklySeries(all, from, to);
  const pe = parentEffort(all, ENQUIRY_FIELDS);
  // Unread is shown as unknown rather than as "0 published".
  const profileStats = profilesError
    ? null
    : {
        published: (profiles ?? []).length,
        ai: (profiles ?? []).filter((p) => p.narrative_source === "ai").length,
        fellBack: (profiles ?? []).filter((p) => p.validation_status === "failed").length,
      };
  const toOffer = now.medianDaysToOffer;

  return (
    <>
      {header}
      <div className="@container">
        {toolbar}

        <section aria-label="Headline figures" className={cn(PANEL, "mb-6 grid grid-cols-2 gap-px overflow-hidden bg-border/80 @xl:grid-cols-3 @4xl:grid-cols-6")}>
          <Headline label="Enquiries" value={fmtCount(now.enquiries)} delta={delta(now.enquiries, then?.enquiries ?? null)} />
          <Headline label="Enrolled" value={fmtCount(now.enrolled)} delta={delta(now.enrolled, then?.enrolled ?? null)} />
          <Headline label="Enrolment rate" value={pct(now.enquiryToEnrolment)} delta={delta(now.enquiryToEnrolment, then?.enquiryToEnrolment ?? null, "fraction")} kind="fraction" hint="of enquiries, enrolled" />
          <Headline label="Offers accepted" value={pct(now.offerAcceptance)} delta={delta(now.offerAcceptance, then?.offerAcceptance ?? null, "fraction")} kind="fraction" hint="of offers sent" />
          <Headline label="No-show rate" value={pct(now.noShowRate)} delta={delta(now.noShowRate, then?.noShowRate ?? null, "fraction")} kind="fraction" goodWhen="down" hint="of assessment bookings" />
          <Headline
            label="Days to an offer"
            value={toOffer === null ? "—" : toOffer < 1 ? fmtDays(toOffer) : toOffer.toFixed(1)}
            unit={toOffer !== null && toOffer >= 1 ? "days" : undefined}
            delta={delta(toOffer, then?.medianDaysToOffer ?? null, "days")}
            kind="days"
            goodWhen="down"
            hint="from enquiry, the median of each step added together"
          />
        </section>

        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section aria-labelledby="funnel-heading" className={cn(PANEL, "p-5")}>
            <SectionHeading id="funnel-heading" title="Admissions funnel" description="How many families reached each stage." />
            <FunnelChart stages={stages} highlight={weakestDetail?.stage ?? null} />
            {weakestDetail || assessedNow < counts.enquiries || deferred.count > 0 ? (
              <div className="mt-5 space-y-1.5 border-t border-border/70 pt-4 text-xs text-muted-foreground">
                {weakestDetail ? (
                  <p className="flex items-center gap-1.5">
                    <span className="size-2.5 shrink-0 rounded-[3px] bg-warning/75" aria-hidden />
                    Weakest step: {weakestDetail.label}, {pct(weakestDetail.rate)}
                  </p>
                ) : null}
                {assessedNow < counts.enquiries ? (
                  <p>Booked, attended and assessment completed count only the families whose route includes an assessment.</p>
                ) : null}
                {/* Beside the funnel, not in it: a pause is not a stage families
                    pass through on the way to enrolling. */}
                {deferred.count > 0 ? (
                  <p>
                    <span className="font-medium text-foreground">{fmtCount(deferred.count)} deferred</span>
                    {deferred.dueWithin > 0 ? `, ${fmtCount(deferred.dueWithin)} due back within 90 days` : ", none due back within 90 days"}.
                    Paused at the family&rsquo;s request. They count in the stages they reached, and the forecast leaves them out.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="losing-heading" className={cn(PANEL, "p-5")}>
            <SectionHeading id="losing-heading" title="Where are we losing applicants?" description="Conversion at each step, against the period before." />
            <StepList steps={steps} weakest={weakest} links={canAccessPath(permissions, "/staff/applications") ? drillDowns(sp.campus) : undefined} />
          </section>
        </div>

        <section aria-labelledby="breakdowns-heading" className="mt-10">
          <h2 id="breakdowns-heading" className="mb-3 text-base font-semibold text-foreground">Breakdowns</h2>
          <div className={cn(PANEL, "grid grid-cols-1 gap-px overflow-hidden bg-border/70 @2xl:grid-cols-2 @4xl:grid-cols-3")}>
            {[
              { id: "heard", title: "Where families heard about us", rows: heard, wide: true },
              { id: "campus", title: "By campus", rows: byCampus, wide: false },
              { id: "grade", title: "By grade", rows: byGrade, wide: false },
            ].map((b) => (
              <div key={b.id} className={cn("bg-card p-5", b.wide && "@2xl:col-span-2 @4xl:col-span-1")}>
                <h3 className="mb-3 text-sm font-semibold text-foreground">{b.title}</h3>
                {b.rows.length ? <BarList rows={b.rows} /> : <p className="text-sm text-muted-foreground">No enquiries in this period.</p>}
              </div>
            ))}
            <div className="bg-card p-5 @2xl:col-span-2 @4xl:col-span-3">
              <h3 className="mb-4 text-sm font-semibold text-foreground">Week by week</h3>
              <TrendChart series={series} />
            </div>
          </div>

          <div className={cn(PANEL, "mt-6 divide-y divide-border/70 overflow-hidden")}>
            {/* Open once somebody has chosen what to break it down by; folded
                away otherwise, because it is the detail under the pictures. */}
            <details open={Boolean(sp.dim)} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                Breakdown by {DIMENSION_LABELS[dim].toLowerCase()}
              </summary>
              <div className="pb-2">
                <div className="flex items-center gap-2 px-5 pb-3 text-[13px] text-muted-foreground">
                  <span aria-hidden>Group by</span>
                  <ParamSelect
                    name="dim"
                    label="Group by"
                    value={dim}
                    options={DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
                    className="h-8 w-56 rounded-lg py-0 text-[13px] md:h-8 md:text-[13px]"
                  />
                </div>
                {groups.length ? (
                  <div className="overflow-x-auto">
                    <table className="data-table [&_tbody_td:first-child]:pl-5 [&_tbody_td:last-child]:pr-5 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:tracking-normal [&_thead_th]:normal-case [&_thead_th:first-child]:pl-5 [&_thead_th:last-child]:pr-5">
                      <thead>
                        <tr>
                          <th>{DIMENSION_LABELS[dim]}</th>
                          {["Enquiries", "Booked", "Attended", "No-shows", "Approved", "Offered", "Accepted", "Paid", "Enrolled"].map((h) => (
                            <th key={h} className="text-right">{h}</th>
                          ))}
                          <th className="text-right whitespace-nowrap">Offer → accepted</th>
                          <th className="text-right whitespace-nowrap">Enquiry → enrolment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => (
                          <tr key={g.key}>
                            <td className="font-medium whitespace-nowrap">{g.label}</td>
                            {[g.counts.enquiries, g.counts.bookings, g.counts.attended, g.counts.noShows, g.counts.approved, g.counts.offered, g.counts.accepted, g.counts.paid, g.counts.enrolled].map((v, i) => (
                              <td key={i} className="text-right tabular-nums">{fmtCount(v)}</td>
                            ))}
                            <td className="text-right"><span className="inline-flex justify-end"><PctBar value={g.counts.offered ? g.counts.accepted / g.counts.offered : null} /></span></td>
                            <td className="text-right"><span className="inline-flex justify-end"><PctBar value={g.enquiryToEnrolment} /></span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 pb-3 text-sm text-muted-foreground">No applications in this period.</p>
                )}
              </div>
            </details>

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                How long each step takes, and how much a parent has to do
              </summary>
              <div className="grid grid-cols-1 gap-8 px-5 pt-1 pb-5 text-sm @3xl:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-foreground">Median days per step</h3>
                  <table className="w-full">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-1.5 text-left font-medium">Step</th>
                        <th className="pb-1.5 text-right font-medium">This period</th>
                        <th className="pb-1.5 pl-4 text-right font-medium">Before</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Enquiry → booking", cycle.enquiryToBooking, prevCycle?.enquiryToBooking ?? null],
                        ["Booking → assessment", cycle.bookingToAssessment, prevCycle?.bookingToAssessment ?? null],
                        ["Assessment → decision", cycle.assessmentToDecision, prevCycle?.assessmentToDecision ?? null],
                        ["Decision → offer", cycle.decisionToOffer, prevCycle?.decisionToOffer ?? null],
                        ["Offer → acceptance", cycle.offerToAcceptance, prevCycle?.offerToAcceptance ?? null],
                        ["Acceptance → payment", cycle.acceptanceToPayment, prevCycle?.acceptanceToPayment ?? null],
                        ["Payment → enrolment", cycle.paymentToEnrolment, prevCycle?.paymentToEnrolment ?? null],
                      ].map(([label, cur, prv]) => (
                        <tr key={label as string} className="border-t border-border/70">
                          <td className="py-1.5 text-muted-foreground">{label as string}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtD(cur as number | null)}</td>
                          <td className="py-1.5 pl-4 text-right text-muted-foreground tabular-nums">{fmtD(prv as number | null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-foreground">Parent effort</h3>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 [&>dd]:border-t [&>dd]:border-border/70 [&>dd]:py-1.5 [&>dt]:border-t [&>dt]:border-border/70 [&>dt]:py-1.5">
                    <dt className="text-muted-foreground">Median time to enquire</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.median_seconds_to_enquiry)}</dd>
                    <dt className="text-muted-foreground">Median time to a booking</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.median_seconds_to_booking)}</dd>
                    <dt className="text-muted-foreground">Slowest tenth to a booking</dt><dd className="text-right tabular-nums">{fmtSeconds(effort?.p90_seconds_to_booking)}</dd>
                    <dt className="text-muted-foreground">Fields before the assessment</dt><dd className="text-right tabular-nums">{pe.fieldsBeforeAssessment}</dd>
                    <dt className="text-muted-foreground">Started but never enquired</dt><dd className="text-right tabular-nums">{pct(effort && effort.sessions_started ? 1 - effort.enquiries_submitted / effort.sessions_started : null)}</dd>
                    <dt className="text-muted-foreground">Enquired but never booked</dt><dd className="text-right tabular-nums">{pct(pe.bookingAbandonment)}</dd>
                    <dt className="text-muted-foreground">Entered by staff, not the parent</dt><dd className="text-right tabular-nums">{pct(pe.staffAssisted)}</dd>
                    <dt className="text-muted-foreground">Messages per applicant</dt><dd className="text-right tabular-nums">{pe.messagesPerApplicant === null ? "—" : pe.messagesPerApplicant.toFixed(1)}</dd>
                    <dt className="text-muted-foreground">Registration already filled in</dt><dd className="text-right tabular-nums">{pct(pe.prefilledAtRegistration)}</dd>
                    <dt className="text-muted-foreground">Learning profiles published</dt><dd className="text-right tabular-nums">{profileStats ? `${profileStats.published} (${pct(profileStats.published ? profileStats.ai / profileStats.published : null)} with an AI narrative, ${profileStats.fellBack} rejected by the validator)` : "—"}</dd>
                  </dl>
                </div>
              </div>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}
