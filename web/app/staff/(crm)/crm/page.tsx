import Link from "next/link";
import { ArrowRight, CalendarHeart, HeartHandshake, Mail, MessageCircle, Sparkles, SquareCheck, TriangleAlert, Users } from "lucide-react";
import { CampusPicker } from "@/components/crm/campus-picker";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { StatTile } from "@/components/staff/stat-tile";
import { LIFECYCLE_LABELS, PIPELINE_STAGES } from "@/lib/crm/lifecycle";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";

type Counts = {
  families_total?: number;
  families_active?: number;
  families_new_this_month?: number;
  enquiries_new_this_month?: number;
  students_active?: number;
  by_lifecycle?: Record<string, number>;
  by_campus?: Array<{ campus_id: string | null; campus_name: string | null; families: number }>;
  whatsapp_sent_30d?: number;
  emails_sent_30d?: number;
  campaigns_active?: number;
  campaigns_pending_approval?: number;
  replies_waiting?: number;
  follow_ups_due?: number;
  no_contact_30d?: number;
  tasks_due_today?: number;
  tasks_overdue?: number;
  tasks_upcoming?: number;
  opportunities?: Array<{ type_code: string; families: number }>;
  multiple_children_one_enrolled?: number;
  reenrolment_outstanding?: number;
  events_upcoming?: number;
};

/**
 * The CRM's first screen. "What is happening with our parents and families?"
 * The family overview, the pipeline by lifecycle stage, what has gone out
 * and what is waiting, the day's tasks, and the marketing opportunities the
 * rules found — every figure a link into the filtered list it counts.
 *
 * One call for the numbers (`crm_dashboard_counts`, security invoker), so
 * the screen is the caller's campuses and the picker narrows it further.
 */
export default async function CrmDashboardPage({ searchParams }: { searchParams: Promise<{ campus?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireStaff("crm.read");
  const campus = sp.campus || null;

  const [{ data: countsRaw }, { data: campuses }, { data: myTasks }, { data: summary }, { data: types }, { data: followUps }] = await Promise.all([
    supabase.rpc("crm_dashboard_counts", { p_campus_id: campus }),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase
      .from("tasks")
      .select("id, title, due_at, priority, student_id, application_id, students(family_id)")
      .eq("status", "open")
      .eq("assignee_staff_id", userId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(6),
    supabase.rpc("crm_opportunity_summary", { p_campus_id: campus }),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true),
    (() => {
      let q = supabase
        .from("v_crm_family_facts")
        .select("family_id, display_name, family_code, next_follow_up_at, primary_first_name, primary_last_name")
        .lte("next_follow_up_at", new Date().toISOString())
        .order("next_follow_up_at")
        .limit(6);
      if (campus) q = q.eq("campus_id", campus);
      return q;
    })(),
  ]);
  const c = (countsRaw ?? {}) as Counts;
  const n = (k: keyof Counts) => (typeof c[k] === "number" ? (c[k] as number) : 0);
  const typeName = new Map((types ?? []).map((t) => [t.code, t.name]));
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const cq = campus ? `&campus=${campus}` : "";

  const opportunities = (summary ?? []).filter((s) => s.identified + s.contacted + s.interested > 0);
  const marketing: Array<{ line: string; href: string; value: number }> = [
    ...opportunities.map((o) => ({
      line: `${o.identified + o.contacted + o.interested} families have an open ${o.type_name} opportunity`,
      href: `/staff/crm/opportunities?type=${o.type_code}${cq}`,
      value: o.identified + o.contacted + o.interested,
    })),
    { line: `${n("multiple_children_one_enrolled")} families have more than one child but only one enrolled`, href: `/staff/crm/families?opportunity=additional_enrolment${cq}`, value: n("multiple_children_one_enrolled") },
    { line: `${n("reenrolment_outstanding")} families have not answered re-enrolment`, href: `/staff/crm/families?lifecycle=reenrolment${cq}`, value: n("reenrolment_outstanding") },
    { line: `${n("no_contact_30d")} active families have had no contact in 30 days`, href: `/staff/crm/families?contact=none_30d${cq}`, value: n("no_contact_30d") },
  ].filter((m) => m.value > 0);

  const attention: Array<{ label: string; value: number; href: string; urgent?: boolean }> = [
    { label: "WhatsApp replies waiting", value: n("replies_waiting"), href: "/staff/crm/whatsapp?unread=1" },
    { label: "Follow-ups due", value: n("follow_ups_due"), href: `/staff/crm/families?contact=follow_up_due${cq}` },
    { label: "Campaigns waiting for approval", value: n("campaigns_pending_approval"), href: "/staff/crm/campaigns?status=pending_approval" },
    { label: "Tasks overdue", value: n("tasks_overdue"), href: "/staff/crm/tasks?filter=overdue", urgent: true },
  ].filter((a) => a.value > 0);

  return (
    <>
      <PageTitle title="Hibiscus CRM" description="What is happening with our parents and families.">
        <CampusPicker campuses={campuses ?? []} current={campus} />
      </PageTitle>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active families" value={n("families_active")} icon={HeartHandshake} tone="success" href={`/staff/crm/families?lifecycle=active${cq}`} />
        <StatTile label="New this month" value={n("families_new_this_month")} icon={Users} tone="info" href={`/staff/crm/families?${campus ? `campus=${campus}` : ""}`} hint="families" />
        <StatTile label="New enquiries" value={n("enquiries_new_this_month")} icon={Users} tone="info" href={`/staff/crm/families?lifecycle=new_enquiry${cq}`} hint="this month" />
        <StatTile label="Active students" value={n("students_active")} icon={Users} href={`/staff/crm/students?${campus ? `campus=${campus}` : ""}`} />
        <StatTile label="Replies waiting" value={n("replies_waiting")} icon={MessageCircle} tone="warning" href="/staff/crm/whatsapp?unread=1" />
        <StatTile label="Events coming" value={n("events_upcoming")} icon={CalendarHeart} href="/staff/crm/events" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section aria-label="Pipeline" className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Families by lifecycle stage</h2>
              <Link href={`/staff/crm/families?${campus ? `campus=${campus}` : ""}`} className="text-xs font-medium text-primary hover:underline">All families</Link>
            </div>
            <table className="data-table">
              <thead><tr><th>Stage</th><th className="text-right">Families</th><th className="w-8" /></tr></thead>
              <tbody>
                {PIPELINE_STAGES.map((stage) => (
                  <tr key={stage}>
                    <td><Link href={`/staff/crm/families?lifecycle=${stage}${cq}`} className="font-medium hover:underline">{LIFECYCLE_LABELS[stage]}</Link></td>
                    <td className="text-right font-semibold tabular-nums">{c.by_lifecycle?.[stage] ?? 0}</td>
                    <td className="text-muted-foreground"><ArrowRight className="size-4" aria-hidden /></td>
                  </tr>
                ))}
                <tr>
                  <td><Link href={`/staff/crm/families?lifecycle=inactive${cq}`} className="text-muted-foreground hover:underline">{LIFECYCLE_LABELS.inactive}</Link></td>
                  <td className="text-right tabular-nums text-muted-foreground">{c.by_lifecycle?.inactive ?? 0}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </section>

          <section aria-label="Marketing opportunities" className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div>
                <h2 className="font-semibold">Marketing opportunities</h2>
                <p className="text-xs text-muted-foreground">What the rules found, and the families nobody has spoken to. Each line opens the list.</p>
              </div>
              <Link href={`/staff/crm/opportunities?${campus ? `campus=${campus}` : ""}`} className="text-xs font-medium text-primary hover:underline">Opportunities</Link>
            </div>
            {marketing.length ? (
              <ul className="divide-y divide-border/70">
                {marketing.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                      <span className="flex size-6 items-center justify-center rounded-full bg-accent text-primary"><Sparkles className="size-3.5" aria-hidden /></span>
                      <span className="flex-1">{m.line}</span>
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-5"><EmptyState>Nothing identified yet. Switch the opportunity rules on under Settings, or add an opportunity to a family by hand.</EmptyState></div>
            )}
          </section>

          {opportunities.length ? (
            <section aria-label="Opportunity pipeline" className="surface">
              <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Opportunity pipeline</h2></div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Type</th><th className="text-right">Open</th><th className="text-right">Contacted</th><th className="text-right">Interested</th><th className="text-right">Registered</th><th className="text-right">Potential</th><th className="text-right">Actual</th></tr></thead>
                  <tbody>
                    {opportunities.map((o) => (
                      <tr key={o.type_code}>
                        <td><Link href={`/staff/crm/opportunities?type=${o.type_code}${cq}`} className="font-medium hover:underline">{typeName.get(o.type_code) ?? o.type_name}</Link></td>
                        <td className="text-right tabular-nums">{o.identified + o.contacted + o.interested}</td>
                        <td className="text-right tabular-nums">{o.contacted}</td>
                        <td className="text-right tabular-nums">{o.interested}</td>
                        <td className="text-right tabular-nums">{o.registered}</td>
                        <td className="text-right tabular-nums">{o.potential_value_minor > 0 ? formatMoney(o.potential_value_minor, o.currency) : <span className="text-muted-foreground">not costed</span>}</td>
                        <td className="text-right tabular-nums">{o.actual_value_minor > 0 ? formatMoney(o.actual_value_minor, o.currency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {attention.length ? (
            <section aria-label="Needs attention" className="surface">
              <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Needs attention</h2></div>
              <ul className="divide-y divide-border/70">
                {attention.map((a) => (
                  <li key={a.label}>
                    <Link href={a.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                      <span className={a.urgent ? "flex size-6 items-center justify-center rounded-full bg-destructive/12 text-destructive" : "flex size-6 items-center justify-center rounded-full bg-warning/30 text-warning-foreground"}>
                        <TriangleAlert className="size-3.5" aria-hidden />
                      </span>
                      <span className="flex-1">{a.label}</span>
                      <span className="font-semibold tabular-nums">{a.value}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section aria-label="Communications" className="surface px-5 py-4">
            <h2 className="font-semibold">Communications, last 30 days</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground"><MessageCircle className="mr-1 inline size-3.5" aria-hidden />WhatsApp sent</dt><dd className="text-2xl font-semibold tabular-nums">{n("whatsapp_sent_30d")}</dd></div>
              <div><dt className="text-xs text-muted-foreground"><Mail className="mr-1 inline size-3.5" aria-hidden />Emails sent</dt><dd className="text-2xl font-semibold tabular-nums">{n("emails_sent_30d")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Campaigns active</dt><dd className="text-2xl font-semibold tabular-nums"><Link href="/staff/crm/campaigns" className="hover:underline">{n("campaigns_active")}</Link></dd></div>
              <div><dt className="text-xs text-muted-foreground">Follow-ups due</dt><dd className="text-2xl font-semibold tabular-nums"><Link href={`/staff/crm/families?contact=follow_up_due${cq}`} className="hover:underline">{n("follow_ups_due")}</Link></dd></div>
            </dl>
          </section>

          <section aria-label="Tasks" className="surface px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Tasks</h2>
              <Link href="/staff/crm/tasks" className="text-xs font-medium text-primary hover:underline">All tasks</Link>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <Link href="/staff/crm/tasks?filter=today" className="rounded-xl bg-muted/60 py-2 hover:bg-muted"><dt className="text-[11px] text-muted-foreground uppercase">Today</dt><dd className="text-xl font-semibold tabular-nums">{n("tasks_due_today")}</dd></Link>
              <Link href="/staff/crm/tasks?filter=overdue" className="rounded-xl bg-muted/60 py-2 hover:bg-muted"><dt className="text-[11px] text-muted-foreground uppercase">Overdue</dt><dd className={`text-xl font-semibold tabular-nums ${n("tasks_overdue") > 0 ? "text-destructive" : ""}`}>{n("tasks_overdue")}</dd></Link>
              <Link href="/staff/crm/tasks?filter=upcoming" className="rounded-xl bg-muted/60 py-2 hover:bg-muted"><dt className="text-[11px] text-muted-foreground uppercase">Next 7 days</dt><dd className="text-xl font-semibold tabular-nums">{n("tasks_upcoming")}</dd></Link>
            </dl>
            {myTasks && myTasks.length > 0 ? (
              <ul className="mt-3 divide-y divide-border/70 text-sm">
                {myTasks.map((t) => {
                  const familyId = one(t.students)?.family_id;
                  const where = familyId ? `/staff/crm/families/${familyId}` : t.application_id ? `/staff/applications/${t.application_id}` : "/staff/crm/tasks?filter=mine";
                  return (
                    <li key={t.id} className="flex items-center gap-2 py-2">
                      <SquareCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <Link href={where} className="min-w-0 flex-1 truncate hover:underline">{t.title}</Link>
                      <span className="text-xs text-muted-foreground">{t.due_at ? t.due_at.slice(0, 10) : ""}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Nothing assigned to you.</p>
            )}
          </section>

          {followUps && followUps.length > 0 ? (
            <section aria-label="Follow-ups due" className="surface px-5 py-4">
              <h2 className="font-semibold">Follow-ups due</h2>
              <ul className="mt-2 divide-y divide-border/70 text-sm">
                {followUps.map((f) => (
                  <li key={f.family_id} className="py-2">
                    <Link href={`/staff/crm/families/${f.family_id}`} className="font-medium hover:underline">{f.display_name ?? f.family_code} family</Link>
                    <span className="block text-xs text-muted-foreground">{f.primary_first_name} {f.primary_last_name} · due {f.next_follow_up_at?.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!campus && (c.by_campus ?? []).length > 1 ? (
            <section aria-label="Families by campus" className="surface px-5 py-4">
              <h2 className="font-semibold">Families by campus</h2>
              <ul className="mt-2 divide-y divide-border/70 text-sm">
                {(c.by_campus ?? []).map((row) => (
                  <li key={row.campus_id ?? "none"} className="flex items-center justify-between py-1.5">
                    <Link href={row.campus_id ? `/staff/crm/families?campus=${row.campus_id}` : "/staff/crm/families"} className="hover:underline">{row.campus_name ?? "No campus yet"}</Link>
                    <span className="font-semibold tabular-nums">{row.families}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Families total: {n("families_total")}. Every figure is what you may see; the campus picker narrows it.</p>
    </>
  );
}
