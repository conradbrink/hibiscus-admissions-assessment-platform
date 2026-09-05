import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
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
import { daysAgoDateString, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

/**
 * Admissions analytics: the funnel the specification lists, conversion
 * between stages, cycle times, the parent-effort figures the project is
 * judged on, and every one of them broken down by campus, grade, period,
 * lead source or assessment outcome. All arithmetic is in lib/analytics and
 * tested; this page reads the facts view through RLS and renders.
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

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("analytics.read");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : toSchoolDateString(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : daysAgoDateString(90);
  const dim: Dimension = (DIMENSIONS as readonly string[]).includes(sp.dim ?? "") ? (sp.dim as Dimension) : "campus";

  let q = supabase
    .from("v_application_facts")
    .select("*")
    .gte("enquired_at", `${from}T00:00:00+02:00`)
    .lte("enquired_at", `${to}T23:59:59+02:00`)
    .limit(5000);
  if (sp.campus) q = q.eq("campus_id", sp.campus);

  const [{ data: rows }, { data: effort }, { data: campuses }, { data: profiles }] = await Promise.all([
    q,
    supabase.from("v_funnel_effort").select("*").maybeSingle(),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("learning_profiles").select("application_id, narrative_source, validation_status").not("published_at", "is", null).gte("created_at", `${from}T00:00:00+02:00`),
  ]);

  const all = (rows ?? []) as FactRow[];
  const counts = funnelCounts(all);
  const assessedEnquiries = all.filter((r) => r.requires_assessment).length;
  const conv = conversion(counts, assessedEnquiries);
  const cycle = cycleTimes(all);
  const groups = groupBy(all, dim);
  const series = weeklySeries(all, from, to);
  const pe = parentEffort(all, ENQUIRY_FIELDS);
  const profileStats = {
    published: (profiles ?? []).length,
    ai: (profiles ?? []).filter((p) => p.narrative_source === "ai").length,
    fellBack: (profiles ?? []).filter((p) => p.validation_status === "failed").length,
  };
  const qs = new URLSearchParams({ from, to, ...(sp.campus ? { campus: sp.campus } : {}), dim }).toString();

  return (
    <>
      <PageTitle title="Analytics" description={`Applications enquired between ${from} and ${to}.`}>
        <Link href="/staff/analytics/forecast" className="text-sm underline">Forecast</Link>
      </PageTitle>
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <Input type="date" name="from" defaultValue={from} className="w-40" />
        <Input type="date" name="to" defaultValue={to} className="w-40" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="dim" defaultValue={dim} className="w-48">
          {DIMENSIONS.map((d) => <option key={d} value={d}>By {DIMENSION_LABELS[d].toLowerCase()}</option>)}
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Apply</Button>
        {can(permissions, "data.export") ? (
          <a href={`/staff/analytics/export?${qs}`} className="text-sm text-primary underline underline-offset-2">Export CSV</a>
        ) : null}
      </form>

      <h2 className="mb-2 text-sm font-semibold">Parent effort</h2>
      <p className="mb-2 text-xs text-muted-foreground">The target is a booked assessment in under three minutes, from eight fields, with nothing typed twice.</p>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Median time to enquiry" value={fmtSeconds(effort?.median_seconds_to_enquiry)} />
        <StatTile label="Median time to booking" value={fmtSeconds(effort?.median_seconds_to_booking)} tone="success" />
        <StatTile label="90th percentile to booking" value={fmtSeconds(effort?.p90_seconds_to_booking)} />
        <StatTile label="Fields before assessment" value={pe.fieldsBeforeAssessment} />
        <StatTile label="Enquiry abandonment" value={pct(effort && effort.sessions_started ? 1 - effort.enquiries_submitted / effort.sessions_started : null)} />
        <StatTile label="Booking abandonment" value={pct(pe.bookingAbandonment)} />
        <StatTile label="Staff-assisted applications" value={pct(pe.staffAssisted)} />
        <StatTile label="Messages per applicant" value={pe.messagesPerApplicant === null ? "—" : pe.messagesPerApplicant.toFixed(1)} />
        <StatTile label="Emails per applicant" value={pe.emailsPerApplicant === null ? "—" : pe.emailsPerApplicant.toFixed(1)} />
        <StatTile label="Registration prefilled" value={pct(pe.prefilledAtRegistration)} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Funnel</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Enquiries" value={counts.enquiries} />
        <StatTile label="Assessment bookings" value={counts.bookings} />
        <StatTile label="Attended" value={counts.attended} />
        <StatTile label="No-shows" value={counts.noShows} tone="warning" />
        <StatTile label="Assessments completed" value={counts.completed} />
        <StatTile label="Decisions" value={counts.decided} />
        <StatTile label="Approved" value={counts.approved} />
        <StatTile label="Waitlisted" value={counts.waitlisted} />
        <StatTile label="Declined" value={counts.declined} />
        <StatTile label="Offers sent" value={counts.offered} />
        <StatTile label="Offers accepted" value={counts.accepted} />
        <StatTile label="Paid" value={counts.paid} />
        <StatTile label="Enrolled" value={counts.enrolled} tone="success" />
        <StatTile label="Withdrawn" value={counts.withdrawn} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Conversion</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Enquiry → assessment booking</dt><dd className="tabular-nums">{pct(conv.enquiryToBooking)}</dd>
            <dt className="text-muted-foreground">Booking → attendance</dt><dd className="tabular-nums">{pct(conv.bookingToAttendance)}</dd>
            <dt className="text-muted-foreground">Admission approval rate</dt><dd className="tabular-nums">{pct(conv.approvalRate)}</dd>
            <dt className="text-muted-foreground">Assessment → offer</dt><dd className="tabular-nums">{pct(conv.assessmentToOffer)}</dd>
            <dt className="text-muted-foreground">Offer → acceptance</dt><dd className="tabular-nums">{pct(conv.offerToAcceptance)}</dd>
            <dt className="text-muted-foreground">Acceptance → payment</dt><dd className="tabular-nums">{pct(conv.acceptanceToPayment)}</dd>
            <dt className="text-muted-foreground">Payment → enrolment</dt><dd className="tabular-nums">{pct(conv.paymentToEnrolment)}</dd>
            <dt className="font-medium">Enquiry → enrolment</dt><dd className="font-medium tabular-nums">{pct(conv.enquiryToEnrolment)}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Cycle times <span className="font-normal text-muted-foreground">(median)</span></h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Enquiry → booking</dt><dd className="tabular-nums">{fmtDays(cycle.enquiryToBooking)}</dd>
            <dt className="text-muted-foreground">Booking → assessment</dt><dd className="tabular-nums">{fmtDays(cycle.bookingToAssessment)}</dd>
            <dt className="text-muted-foreground">Assessment → decision</dt><dd className="tabular-nums">{fmtDays(cycle.assessmentToDecision)}</dd>
            <dt className="text-muted-foreground">Decision → offer</dt><dd className="tabular-nums">{fmtDays(cycle.decisionToOffer)}</dd>
            <dt className="text-muted-foreground">Offer → acceptance</dt><dd className="tabular-nums">{fmtDays(cycle.offerToAcceptance)}</dd>
            <dt className="text-muted-foreground">Acceptance → payment</dt><dd className="tabular-nums">{fmtDays(cycle.acceptanceToPayment)}</dd>
            <dt className="text-muted-foreground">Payment → enrolment</dt><dd className="tabular-nums">{fmtDays(cycle.paymentToEnrolment)}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Trend</h2>
          <TrendChart series={series} />
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Learning profiles</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Published</dt><dd className="tabular-nums">{profileStats.published}</dd>
            <dt className="text-muted-foreground">With an AI narrative</dt><dd className="tabular-nums">{pct(profileStats.published ? profileStats.ai / profileStats.published : null)}</dd>
            <dt className="text-muted-foreground">AI text rejected by the validator</dt><dd className="tabular-nums">{profileStats.fellBack}</dd>
          </dl>
        </section>
      </div>

      <h2 className="mb-2 text-sm font-semibold">By {DIMENSION_LABELS[dim].toLowerCase()}</h2>
      {groups.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{DIMENSION_LABELS[dim]}</th>
                {["Enquiries", "Booked", "Attended", "No-shows", "Assessed", "Approved", "Offered", "Accepted", "Paid", "Enrolled", "Enquiry → enrolment"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => (
                <tr key={g.key}>
                  <td className="px-3 py-2 font-medium">{g.label}</td>
                  {[g.counts.enquiries, g.counts.bookings, g.counts.attended, g.counts.noShows, g.counts.completed, g.counts.approved, g.counts.offered, g.counts.accepted, g.counts.paid, g.counts.enrolled].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">{v}</td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{pct(g.enquiryToEnrolment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No applications in range.</p>
      )}
    </>
  );
}
