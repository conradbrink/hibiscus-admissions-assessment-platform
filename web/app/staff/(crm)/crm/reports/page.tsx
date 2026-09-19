import Link from "next/link";
import { Download } from "lucide-react";
import { PageTitle } from "@/components/staff/page-title";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS } from "@/lib/crm/labels";
import { requireStaff } from "@/lib/staff/session";

/**
 * Exports, as CSV, filtered, for whoever holds `crm.export`. Every download
 * is audited by the route with what was asked for and how many rows went.
 */
export default async function ReportsPage() {
  const { supabase } = await requireStaff("crm.export");
  const [{ data: campuses }, { data: segments }, { data: campaigns }, { data: types }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("segments").select("id, name").order("name"),
    supabase.from("campaigns").select("id, name").order("created_at", { ascending: false }).limit(50),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  const select = (name: string, options: Array<{ value: string; label: string }>, allLabel: string) => (
    <select name={name} className="h-9 rounded-xl border border-input bg-card px-2 text-sm"><option value="">{allLabel}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  );
  const campusOptions = (campuses ?? []).map((c) => ({ value: c.id, label: c.name }));
  const Card = ({ kind, title, blurb, children }: { kind: string; title: string; blurb: string; children?: React.ReactNode }) => (
    <form method="get" action="/staff/crm/reports/export" className="surface space-y-2 p-4">
      <input type="hidden" name="kind" value={kind} />
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{blurb}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
      <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Download className="size-4" aria-hidden /> Download CSV</button>
    </form>
  );
  return (
    <>
      <PageTitle title="Reports and exports" description="Filtered lists as CSV, for the campuses you may see. Every download is recorded in the audit trail." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card kind="families" title="Families" blurb="One row per family with its primary contact, lifecycle, campus, counts and consent.">
          {select("campus", campusOptions, "All campuses")}
          {select("lifecycle", LIFECYCLE_STAGES.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] })), "Any lifecycle")}
          {select("segment", (segments ?? []).map((s) => ({ value: s.id, label: s.name })), "Any segment")}
        </Card>
        <Card kind="contacts" title="Contacts" blurb="One row per parent or guardian with their consent flags.">
          {select("campus", campusOptions, "All campuses")}
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="consented" value="1" /> Only with marketing consent</label>
        </Card>
        <Card kind="students" title="Students" blurb="One row per child with family, campus, grade and status. No medical fields.">
          {select("campus", campusOptions, "All campuses")}
        </Card>
        <Card kind="opportunities" title="Opportunities" blurb="One row per opportunity with family, child, status, value and owner.">
          {select("campus", campusOptions, "All campuses")}
          {select("type", (types ?? []).map((t) => ({ value: t.code, label: t.name })), "Any type")}
          {select("status", OPPORTUNITY_STATUSES.map((s) => ({ value: s, label: OPPORTUNITY_STATUS_LABELS[s] })), "Any status")}
        </Card>
        <Card kind="campaign_recipients" title="Campaign recipients" blurb="Who a campaign reached, who was left out and why, and what became of each message.">
          {select("campaign", (campaigns ?? []).map((c) => ({ value: c.id, label: c.name })), "Choose a campaign")}
        </Card>
        <Card kind="lead_sources" title="Lead sources" blurb="Enquiries, offers and enrolments by source.">
          {select("campus", campusOptions, "All campuses")}
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Admissions exports (applicants, analytics, the student file for Ed-admin) stay under <Link href="/staff/analytics" className="underline">Admissions</Link>.</p>
    </>
  );
}
