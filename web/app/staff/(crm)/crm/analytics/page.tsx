import Link from "next/link";
import { CampusPicker } from "@/components/crm/campus-picker";
import { PageTitle } from "@/components/staff/page-title";
import { LIFECYCLE_LABELS, PIPELINE_STAGES } from "@/lib/crm/lifecycle";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/crm/labels";
import { daysAgoDateString } from "@/lib/format-date";
import { heardFromLabel } from "@/lib/heard-from";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";

function Tile({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (<><p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</>);
  return href ? <Link href={href} className="surface block px-4 py-3 transition-shadow hover:shadow-lift">{body}</Link> : <div className="surface px-4 py-3">{body}</div>;
}

type Counts = { families_total?: number; families_active?: number; families_new_this_month?: number; by_lifecycle?: Record<string, number>; by_campus?: Array<{ campus_id: string | null; campus_name: string | null; families: number }>; students_active?: number; reenrolment_outstanding?: number };

/**
 * CRM analytics: families, communications, campaigns, opportunities,
 * retention and lead sources, over a window, for the campuses the caller
 * may see. Every figure is a count of rows that exist; nothing is
 * estimated, and a figure the providers do not report is shown as such.
 */
export default async function CrmAnalyticsPage({ searchParams }: { searchParams: Promise<{ campus?: string; days?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("analytics.read");
  const campus = sp.campus || null;
  const days = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const since = `${daysAgoDateString(days)}T00:00:00+02:00`;

  const [{ data: countsRaw }, { data: campuses }, emails, whatsapp, { data: campaigns }, { data: opportunities }, { data: leadSources }, { data: students }, { data: reenrolment }, { data: contacts }] = await Promise.all([
    supabase.rpc("crm_dashboard_counts", { p_campus_id: campus }),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("email_messages").select("status, template_key").gte("created_at", since).limit(20000),
    supabase.from("messages").select("status, direction").gte("created_at", since).limit(20000),
    (() => {
      let q = supabase.from("campaigns").select("id, name, status, channel, recipients_total, recipients_email, recipients_whatsapp, finished_at").gte("created_at", since);
      if (campus) q = q.or(`campus_id.is.null,campus_id.eq.${campus}`);
      return q;
    })(),
    supabase.rpc("crm_opportunity_summary", { p_campus_id: campus }),
    supabase.rpc("crm_lead_source_report", { p_campus_id: campus, p_from: since }),
    (() => {
      let q = supabase.from("students").select("status, left_on, created_at");
      if (campus) q = q.eq("current_campus_id", campus);
      return q;
    })(),
    (() => {
      let q = supabase.from("reenrolment_responses").select("intent, answered_at, reenrolment_cycles!inner(status)").eq("reenrolment_cycles.status", "open");
      if (campus) q = q.eq("campus_id", campus);
      return q;
    })(),
    supabase.from("contacts").select("marketing_email_consent, marketing_whatsapp_consent, whatsapp_opt_in, unsubscribed_at, is_active").limit(20000),
  ]);
  const c = (countsRaw ?? {}) as Counts;
  const em = emails.data ?? [];
  const wa = whatsapp.data ?? [];
  const emailCount = (statuses: string[]) => em.filter((e) => statuses.includes(e.status)).length;
  const waCount = (statuses: string[]) => wa.filter((m) => m.direction === "out" && statuses.includes(m.status)).length;
  const campaignsSent = (campaigns ?? []).filter((x) => x.status === "sent");
  const campaignRecipients = campaignsSent.reduce((n, x) => n + (x.recipients_email ?? 0) + (x.recipients_whatsapp ?? 0), 0);
  const campaignOpened = em.filter((e) => e.template_key?.startsWith("campaign:") && (e.status === "opened" || e.status === "clicked")).length;
  const opp = (opportunities ?? []).reduce((acc, s) => ({ created: acc.created + s.total, contacted: acc.contacted + s.contacted + s.interested + s.registered, interested: acc.interested + s.interested, converted: acc.converted + s.registered, lost: acc.lost + s.lost, potential: acc.potential + s.potential_value_minor, actual: acc.actual + s.actual_value_minor }), { created: 0, contacted: 0, interested: 0, converted: 0, lost: 0, potential: 0, actual: 0 });
  const currency = (opportunities ?? [])[0]?.currency ?? "BWP";
  const st = students ?? [];
  const withdrawals = st.filter((s) => s.status === "left" && s.left_on && s.left_on >= daysAgoDateString(days)).length;
  const re = reenrolment ?? [];
  const cts = (contacts ?? []).filter((x) => x.is_active);
  const cq = campus ? `&campus=${campus}` : "";


  return (
    <>
      <PageTitle title="CRM analytics" description={`The last ${days} days for messages, campaigns and lead sources; today's picture for families, students and opportunities.`}>
        <CampusPicker campuses={campuses ?? []} current={campus} />
        <form method="get" className="flex items-center gap-1">{campus ? <input type="hidden" name="campus" value={campus} /> : null}
          {[30, 90, 180, 365].map((d) => <Link key={d} href={`?days=${d}${cq}`} className={`rounded-full border px-2.5 py-1 text-xs ${days === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{d}d</Link>)}
        </form>
      </PageTitle>

      <h2 className="mb-2 text-sm font-semibold">Families</h2>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total families" value={c.families_total ?? 0} href={`/staff/crm/families?${campus ? `campus=${campus}` : ""}`} />
        <Tile label="New this month" value={c.families_new_this_month ?? 0} />
        <Tile label="Active families" value={c.families_active ?? 0} href={`/staff/crm/families?lifecycle=active${cq}`} />
        <Tile label="Inactive families" value={c.by_lifecycle?.inactive ?? 0} href={`/staff/crm/families?lifecycle=inactive${cq}`} />
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <section className="surface p-4"><h3 className="text-xs font-semibold text-muted-foreground uppercase">By lifecycle stage</h3>
          <ul className="mt-2 space-y-1 text-sm">{[...PIPELINE_STAGES, "inactive" as const].map((s) => <li key={s} className="flex justify-between"><Link href={`/staff/crm/families?lifecycle=${s}${cq}`} className="hover:underline">{LIFECYCLE_LABELS[s]}</Link><span className="tabular-nums">{c.by_lifecycle?.[s] ?? 0}</span></li>)}</ul>
        </section>
        <section className="surface p-4"><h3 className="text-xs font-semibold text-muted-foreground uppercase">By campus</h3>
          <ul className="mt-2 space-y-1 text-sm">{(c.by_campus ?? []).map((r) => <li key={r.campus_id ?? "none"} className="flex justify-between"><span>{r.campus_name ?? "No campus yet"}</span><span className="tabular-nums">{r.families}</span></li>)}</ul>
        </section>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Communications, last {days} days</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Emails sent" value={emailCount(["sent", "delivered", "opened", "clicked"])} />
        <Tile label="Delivered" value={emailCount(["delivered", "opened", "clicked"])} hint="where the provider reports it" />
        <Tile label="Opened" value={emailCount(["opened", "clicked"])} />
        <Tile label="Clicked" value={emailCount(["clicked"])} />
        <Tile label="WhatsApp sent" value={waCount(["sent", "delivered", "read"])} />
        <Tile label="Delivered" value={waCount(["delivered", "read"])} />
        <Tile label="Read" value={waCount(["read"])} />
        <Tile label="Replies" value={wa.filter((m) => m.direction === "in").length} href="/staff/crm/whatsapp" />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Campaigns, last {days} days</h2>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Campaigns sent" value={campaignsSent.length} href="/staff/crm/campaigns?status=sent" />
        <Tile label="Recipients" value={campaignRecipients} hint="messages planned across sent campaigns" />
        <Tile label="Engagement" value={campaignOpened} hint="campaign emails opened or clicked" />
        <Tile label="Conversions" value={opp.converted} hint="opportunities registered (all time)" href="/staff/crm/opportunities?status=registered" />
      </div>
      {campaigns?.length ? <ul className="mb-6 divide-y divide-border surface text-sm">{campaigns.map((x) => <li key={x.id} className="flex items-center gap-3 px-4 py-2"><Link href={`/staff/crm/campaigns/${x.id}`} className="min-w-0 flex-1 truncate hover:underline">{x.name}</Link><span className="text-xs text-muted-foreground">{x.channel} · {x.recipients_total ?? 0} families · {CAMPAIGN_STATUS_LABELS[x.status]}</span></li>)}</ul> : <p className="mb-6 text-xs text-muted-foreground">No campaigns in the window.</p>}

      <h2 className="mb-2 text-sm font-semibold">Opportunities</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile label="Created" value={opp.created} href="/staff/crm/opportunities?status=" />
        <Tile label="Contacted" value={opp.contacted} />
        <Tile label="Interested" value={opp.interested} />
        <Tile label="Converted" value={opp.converted} />
        <Tile label="Lost" value={opp.lost} />
        <Tile label="Potential" value={opp.potential ? formatMoney(opp.potential, currency) : "not costed"} />
        <Tile label="Actual" value={opp.actual ? formatMoney(opp.actual, currency) : "—"} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Retention</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Tile label="Attending" value={st.filter((s) => s.status === "active").length} />
        <Tile label="Starting" value={st.filter((s) => s.status === "onboarding").length} />
        <Tile label="Re-enrolment: yes" value={re.filter((r) => r.intent === "returning").length} hint="open rounds" />
        <Tile label="Re-enrolment: no" value={re.filter((r) => r.intent === "not_returning").length} />
        <Tile label="Not yet answered" value={re.filter((r) => !r.answered_at).length} href="/staff/reenrolment" />
        <Tile label="Withdrawals" value={withdrawals} hint={`children who left in ${days} days`} />
        <Tile label="Alumni" value={st.filter((s) => s.status === "left" || s.status === "graduated").length} />
        <Tile label="Consent: email" value={cts.filter((x) => x.marketing_email_consent && !x.unsubscribed_at).length} hint={`of ${cts.length} active contacts`} />
        <Tile label="Consent: WhatsApp" value={cts.filter((x) => x.marketing_whatsapp_consent && x.whatsapp_opt_in).length} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Lead sources, enquiries in the last {days} days</h2>
      <section className="surface overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Source</th><th className="text-right">Families</th><th className="text-right">Enquiries</th><th className="text-right">Reached an offer</th><th className="text-right">Enrolled</th><th className="text-right">Enquiry → enrolled</th></tr></thead>
          <tbody>
            {(leadSources ?? []).map((r) => (
              <tr key={r.lead_source}>
                <td><Link href={`/staff/crm/families?source=${r.lead_source}${cq}`} className="hover:underline">{r.lead_source === "not_asked" ? "Not asked" : heardFromLabel(r.lead_source)}</Link></td>
                <td className="text-right tabular-nums">{r.families}</td><td className="text-right tabular-nums">{r.enquiries}</td><td className="text-right tabular-nums">{r.offers}</td><td className="text-right tabular-nums">{r.enrolled}</td>
                <td className="text-right tabular-nums">{r.enquiries ? `${Math.round((r.enrolled / r.enquiries) * 100)}%` : "—"}</td>
              </tr>
            ))}
            {!leadSources?.length ? <tr><td colSpan={6} className="text-center text-muted-foreground">No enquiries in the window.</td></tr> : null}
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">Sources are the funnel&rsquo;s own &ldquo;how did you hear about us?&rdquo; answers, so Admissions analytics and the CRM count the same thing. The referral figure on the dashboard counts families with a referring family recorded.</p>
    </>
  );
}
