import { PageTitle } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { daysAgoDateString, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

/**
 * Admissions analytics, Phase 1: funnel volumes, conversion between the
 * milestones the timeline records, cycle times as medians, and the
 * parent-effort figures the project is judged on.
 */
type Search = { from?: string; to?: string; campus?: string };

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function days(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

function fmtDays(v: number | null): string {
  if (v === null) return "—";
  if (v < 1) return `${Math.round(v * 24)}h`;
  return `${v.toFixed(1)}d`;
}

function fmtSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("analytics.read");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : toSchoolDateString(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : daysAgoDateString(90);

  let q = supabase
    .from("v_application_milestones")
    .select("*")
    .gte("enquired_at", `${from}T00:00:00+02:00`)
    .lte("enquired_at", `${to}T23:59:59+02:00`);
  if (sp.campus) q = q.eq("campus_id", sp.campus);

  const [{ data: rows }, { data: effort }, { data: campuses }, { data: pipeline }] = await Promise.all([
    q,
    supabase.from("v_funnel_effort").select("*").maybeSingle(),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("v_pipeline_counts").select("*"),
  ]);

  const all = rows ?? [];
  const ids = all.map((r) => r.application_id);
  const [{ data: decisions }, { data: offers }, { data: profiles }] = ids.length
    ? await Promise.all([
        supabase.from("admission_decisions").select("application_id, final_outcome, computed_outcome, decided_by").in("application_id", ids),
        supabase.from("offers").select("application_id, status, sent_at, first_viewed_at").in("application_id", ids),
        supabase.from("learning_profiles").select("application_id, narrative_source, validation_status").in("application_id", ids).not("published_at", "is", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  // The last real decision per application; referrals are not decisions.
  const finalDecision = new Map<string, NonNullable<typeof decisions>[number]>();
  for (const d of decisions ?? []) if (d.final_outcome !== "staff_review") finalDecision.set(d.application_id, d);
  const decided = [...finalDecision.values()];
  const outcomes = {
    approved: decided.filter((d) => d.final_outcome === "approved").length,
    waitlisted: decided.filter((d) => d.final_outcome === "waitlisted").length,
    declined: decided.filter((d) => d.final_outcome === "declined").length,
    byRules: decided.filter((d) => d.decided_by === "rules").length,
    overridden: decided.filter((d) => d.decided_by === "staff" && d.computed_outcome !== "staff_review" && d.computed_outcome !== d.final_outcome).length,
  };
  const offerStats = {
    sent: (offers ?? []).filter((o) => o.sent_at).length,
    viewed: (offers ?? []).filter((o) => o.first_viewed_at).length,
    expired: (offers ?? []).filter((o) => o.status === "expired").length,
    withdrawn: (offers ?? []).filter((o) => o.status === "withdrawn").length,
  };
  const profileStats = {
    published: (profiles ?? []).length,
    ai: (profiles ?? []).filter((p) => p.narrative_source === "ai").length,
    fellBack: (profiles ?? []).filter((p) => p.validation_status === "failed").length,
  };
  const assessed = all.filter((r) => r.requires_assessment);
  const enquiries = all.length;
  const booked = assessed.filter((r) => r.booked_at).length;
  const attended = assessed.filter((r) => r.attended_at).length;
  const noShows = assessed.filter((r) => r.no_show_at).length;
  const completed = assessed.filter((r) => r.assessed_at).length;
  const decidedCount = all.filter((r) => r.decided_at).length;
  const approved = all.filter((r) => ["approved", "offer_draft", "offer_pending_approval", "offer_sent", "offer_expired", "offer_accepted", "payment_required", "payment_processing", "paid", "registration_incomplete", "registration_complete", "enrolled"].includes(r.status)).length;
  const offered = all.filter((r) => r.offered_at).length;
  const accepted = all.filter((r) => r.accepted_at).length;
  const paid = all.filter((r) => r.paid_at).length;
  const enrolled = all.filter((r) => r.enrolled_at).length;
  const withdrawn = all.filter((r) => r.status === "withdrawn").length;

  const cycle = {
    enquiryToBooking: median(assessed.map((r) => days(r.enquired_at, r.booked_at)).filter((v): v is number => v !== null)),
    bookingToAssessment: median(assessed.map((r) => days(r.booked_at, r.assessed_at)).filter((v): v is number => v !== null)),
    assessmentToDecision: median(all.map((r) => days(r.assessed_at ?? r.enquired_at, r.decided_at)).filter((v): v is number => v !== null)),
    decisionToOffer: median(all.map((r) => days(r.decided_at, r.offered_at)).filter((v): v is number => v !== null)),
    offerToAcceptance: median(all.map((r) => days(r.offered_at, r.accepted_at)).filter((v): v is number => v !== null)),
    acceptanceToPayment: median(all.map((r) => days(r.accepted_at, r.paid_at)).filter((v): v is number => v !== null)),
    paymentToEnrolment: median(all.map((r) => days(r.paid_at, r.enrolled_at)).filter((v): v is number => v !== null)),
  };

  const bySource = new Map<string, number>();
  for (const r of all) bySource.set(r.entry_route, (bySource.get(r.entry_route) ?? 0) + 1);
  const byCampus = new Map<string, number>();
  for (const p of pipeline ?? []) byCampus.set(p.campus_name, (byCampus.get(p.campus_name) ?? 0) + p.applications);

  return (
    <>
      <PageTitle title="Analytics" description={`Applications enquired between ${from} and ${to}.`} />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <Input type="date" name="from" defaultValue={from} className="w-40" />
        <Input type="date" name="to" defaultValue={to} className="w-40" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Apply</Button>
      </form>

      <h2 className="mb-2 text-sm font-semibold">Parent effort</h2>
      <p className="mb-2 text-xs text-muted-foreground">All time, from the website funnel. The target is a booked assessment in under three minutes.</p>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Funnel sessions started" value={effort?.sessions_started ?? 0} />
        <StatTile label="Enquiries submitted" value={effort?.enquiries_submitted ?? 0} />
        <StatTile label="Median time to enquiry" value={fmtSeconds(effort?.median_seconds_to_enquiry)} />
        <StatTile label="Median time to booking" value={fmtSeconds(effort?.median_seconds_to_booking)} tone="success" />
        <StatTile label="90th percentile to booking" value={fmtSeconds(effort?.p90_seconds_to_booking)} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Funnel</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatTile label="Enquiries" value={enquiries} />
        <StatTile label="Assessment bookings" value={booked} />
        <StatTile label="Attended" value={attended} />
        <StatTile label="No-shows" value={noShows} tone="warning" />
        <StatTile label="Assessments completed" value={completed} />
        <StatTile label="Decisions" value={decidedCount} />
        <StatTile label="Approved" value={approved} />
        <StatTile label="Offers sent" value={offered} />
        <StatTile label="Offers accepted" value={accepted} />
        <StatTile label="Paid" value={paid} />
        <StatTile label="Enrolled" value={enrolled} tone="success" />
        <StatTile label="Withdrawn" value={withdrawn} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Conversion</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Enquiry → assessment booking</dt><dd className="tabular-nums">{pct(booked, assessed.length)}</dd>
            <dt className="text-muted-foreground">Booking → attendance</dt><dd className="tabular-nums">{pct(attended, booked)}</dd>
            <dt className="text-muted-foreground">Assessment → approval</dt><dd className="tabular-nums">{pct(approved, completed)}</dd>
            <dt className="text-muted-foreground">Approval → offer sent</dt><dd className="tabular-nums">{pct(offered, approved)}</dd>
            <dt className="text-muted-foreground">Offer → acceptance</dt><dd className="tabular-nums">{pct(accepted, offered)}</dd>
            <dt className="text-muted-foreground">Acceptance → payment</dt><dd className="tabular-nums">{pct(paid, accepted)}</dd>
            <dt className="text-muted-foreground">Payment → enrolment</dt><dd className="tabular-nums">{pct(enrolled, paid)}</dd>
            <dt className="font-medium">Enquiry → enrolment</dt><dd className="font-medium tabular-nums">{pct(enrolled, enquiries)}</dd>
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
          <h2 className="mb-2 text-sm font-semibold">Decisions</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Approved</dt><dd className="tabular-nums">{outcomes.approved}</dd>
            <dt className="text-muted-foreground">Waitlisted</dt><dd className="tabular-nums">{outcomes.waitlisted}</dd>
            <dt className="text-muted-foreground">Declined</dt><dd className="tabular-nums">{outcomes.declined}</dd>
            <dt className="text-muted-foreground">Decided by the rules engine</dt><dd className="tabular-nums">{pct(outcomes.byRules, decided.length)}</dd>
            <dt className="text-muted-foreground">Rules outcome overridden by staff</dt><dd className="tabular-nums">{outcomes.overridden}</dd>
            <dt className="text-muted-foreground">Learning profiles published</dt><dd className="tabular-nums">{profileStats.published}</dd>
            <dt className="text-muted-foreground">With an AI narrative</dt><dd className="tabular-nums">{pct(profileStats.ai, profileStats.published)}</dd>
            <dt className="text-muted-foreground">AI text rejected by the validator</dt><dd className="tabular-nums">{profileStats.fellBack}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Offers</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Sent</dt><dd className="tabular-nums">{offerStats.sent}</dd>
            <dt className="text-muted-foreground">Opened by the parent</dt><dd className="tabular-nums">{pct(offerStats.viewed, offerStats.sent)}</dd>
            <dt className="text-muted-foreground">Expired</dt><dd className="tabular-nums">{offerStats.expired}</dd>
            <dt className="text-muted-foreground">Withdrawn and re-issued</dt><dd className="tabular-nums">{offerStats.withdrawn}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Acceptance and payment figures fill in with Phase 3.</p>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">By entry route</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            {[...bySource.entries()].map(([k, v]) => (<><dt key={`${k}-k`} className="text-muted-foreground capitalize">{k}</dt><dd key={`${k}-v`} className="tabular-nums">{v}</dd></>))}
            {bySource.size === 0 ? <dt className="text-muted-foreground">No data in range.</dt> : null}
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Active applications by campus <span className="font-normal text-muted-foreground">(all time)</span></h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            {[...byCampus.entries()].map(([k, v]) => (<><dt key={`${k}-k`} className="text-muted-foreground">{k}</dt><dd key={`${k}-v`} className="tabular-nums">{v}</dd></>))}
          </dl>
        </section>
      </div>
    </>
  );
}
