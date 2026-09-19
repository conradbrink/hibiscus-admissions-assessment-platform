import Link from "next/link";
import { OpportunityBadge, Pagination, Pill, queryBuilder } from "@/components/crm/bits";
import { CampusPicker } from "@/components/crm/campus-picker";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS } from "@/lib/crm/labels";
import { formatDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { OpportunityStatus } from "@/lib/supabase/types";
import { moveOpportunity } from "./actions";

const PAGE = 50;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The opportunity dashboard and the list under it: per type, how many
 * were identified, contacted, interested, registered and lost, what they
 * could be worth and what they were; then every opportunity, filterable,
 * with the status picker on each row so a person works the list here.
 */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ campus?: string; type?: string; status?: string; family?: string; mine?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const campus = sp.campus || null;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  let q = supabase
    .from("opportunities")
    .select("*, opportunity_types(name), families!opportunities_family_id_fkey(display_name, family_code), students(legal_first_name, preferred_name, legal_last_name), staff_profiles!opportunities_assigned_staff_id_fkey(full_name), campuses(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (campus) q = q.eq("campus_id", campus);
  if (sp.type) q = q.eq("type_code", sp.type);
  if (sp.family) q = q.eq("family_id", sp.family);
  if (sp.mine === "1") q = q.eq("assigned_staff_id", userId);
  const status = (OPPORTUNITY_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as OpportunityStatus) : null;
  if (status) q = q.eq("status", status);
  else if (!sp.family) q = q.in("status", ["identified", "contacted", "interested"]);

  const [{ data: rows, count }, { data: summary }, { data: campuses }, { data: staff }] = await Promise.all([
    q,
    supabase.rpc("crm_opportunity_summary", { p_campus_id: campus }),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const qs = queryBuilder(sp);
  const totals = (summary ?? []).reduce(
    (acc, s) => ({ total: acc.total + s.total, open: acc.open + s.identified + s.contacted + s.interested, contacted: acc.contacted + s.contacted + s.interested + s.registered, interested: acc.interested + s.interested, registered: acc.registered + s.registered, lost: acc.lost + s.lost }),
    { total: 0, open: 0, contacted: 0, interested: 0, registered: 0, lost: 0 }
  );
  const decided = totals.registered + totals.lost;
  const rate = decided ? Math.round((totals.registered / decided) * 100) : null;

  return (
    <>
      <PageTitle title="Opportunities" description="What could be offered to a family next, and how each conversation is going.">
        <CampusPicker campuses={campuses ?? []} current={campus} />
      </PageTitle>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Total", totals.total, qs({ status: "", page: undefined })],
          ["Open", totals.open, qs({ status: undefined, page: undefined })],
          ["Contacted", totals.contacted, qs({ status: "contacted", page: undefined })],
          ["Interested", totals.interested, qs({ status: "interested", page: undefined })],
          ["Converted", totals.registered, qs({ status: "registered", page: undefined })],
          ["Lost", totals.lost, qs({ status: "lost", page: undefined })],
        ].map(([label, value, href]) => (
          <Link key={String(label)} href={String(href)} className="surface px-4 py-3 transition-shadow hover:shadow-lift">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </Link>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">Conversion rate: {rate === null ? "no decided opportunities yet" : `${rate}% of decided opportunities were registered`}.</p>

      <section className="surface mb-5 overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Type</th><th className="text-right">Identified</th><th className="text-right">Contacted</th><th className="text-right">Interested</th><th className="text-right">Registered</th><th className="text-right">Lost</th><th className="text-right">Potential</th><th className="text-right">Actual</th></tr></thead>
          <tbody>
            {(summary ?? []).map((s) => (
              <tr key={s.type_code}>
                <td><Link href={qs({ type: s.type_code, page: undefined })} className="font-medium hover:underline">{s.type_name}</Link></td>
                <td className="text-right tabular-nums"><Link href={qs({ type: s.type_code, status: "identified", page: undefined })} className="hover:underline">{s.identified}</Link></td>
                <td className="text-right tabular-nums"><Link href={qs({ type: s.type_code, status: "contacted", page: undefined })} className="hover:underline">{s.contacted}</Link></td>
                <td className="text-right tabular-nums"><Link href={qs({ type: s.type_code, status: "interested", page: undefined })} className="hover:underline">{s.interested}</Link></td>
                <td className="text-right tabular-nums"><Link href={qs({ type: s.type_code, status: "registered", page: undefined })} className="hover:underline">{s.registered}</Link></td>
                <td className="text-right tabular-nums"><Link href={qs({ type: s.type_code, status: "lost", page: undefined })} className="hover:underline">{s.lost}</Link></td>
                <td className="text-right tabular-nums">{s.potential_value_minor > 0 ? formatMoney(s.potential_value_minor, s.currency) : <span className="text-muted-foreground">not costed</span>}</td>
                <td className="text-right tabular-nums">{s.actual_value_minor > 0 ? formatMoney(s.actual_value_minor, s.currency) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill href={qs({ status: undefined, type: undefined, mine: undefined, page: undefined })} active={!status && !sp.type && !sp.mine}>Open</Pill>
        {OPPORTUNITY_STATUSES.map((s) => <Pill key={s} href={qs({ status: s, page: undefined })} active={status === s}>{OPPORTUNITY_STATUS_LABELS[s]}</Pill>)}
        <Pill href={qs({ mine: sp.mine === "1" ? undefined : "1", page: undefined })} active={sp.mine === "1"}>Mine</Pill>
        {sp.type ? <Pill href={qs({ type: undefined, page: undefined })} active>× {sp.type}</Pill> : null}
      </div>

      {rows?.length ? (
        <ul className="space-y-2">
          {rows.map((o) => {
            const fam = one(o.families);
            const student = one(o.students);
            return (
              <li key={o.id} className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{one(o.opportunity_types)?.name ?? o.type_code}</span>
                    <span className="text-muted-foreground"> · </span>
                    <Link href={`/staff/crm/families/${o.family_id}`} className="hover:underline">{fam?.display_name ?? fam?.family_code} family</Link>
                    {student ? <span className="text-muted-foreground"> · {student.preferred_name || student.legal_first_name} {student.legal_last_name}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {one(o.campuses)?.name} · {o.estimated_value_minor ? formatMoney(o.estimated_value_minor, o.currency) : "not costed"} · {one(o.staff_profiles)?.full_name ?? "unassigned"} · {formatDate(o.created_at)}
                    {o.source === "rule" ? ` · rule ${o.rule_code}` : ""}{o.next_action ? ` · next: ${o.next_action}${o.next_action_at ? ` by ${formatDate(o.next_action_at)}` : ""}` : ""}{o.lost_reason ? ` · lost: ${o.lost_reason}` : ""}
                  </p>
                </div>
                <OpportunityBadge status={o.status} />
                {canWrite && o.status !== "registered" && o.status !== "lost" ? (
                  <ActionForm action={moveOpportunity} label="Save" size="xs" variant="outline" resetOnSubmit={false} className="flex flex-wrap items-center gap-1 space-y-0">
                    <input type="hidden" name="opportunityId" value={o.id} />
                    <NativeSelect name="status" defaultValue={o.status} className="h-7 w-32 py-0 text-xs md:h-7" aria-label="Status">
                      {OPPORTUNITY_STATUSES.map((s) => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABELS[s]}</option>)}
                    </NativeSelect>
                    <NativeSelect name="assigneeStaffId" defaultValue={o.assigned_staff_id ?? ""} className="h-7 w-36 py-0 text-xs md:h-7" aria-label="Assigned to">
                      <option value="">Unassigned</option>
                      {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </NativeSelect>
                    <Input name="nextAction" defaultValue={o.next_action ?? ""} placeholder="Next action" className="h-7 w-36 text-xs md:h-7" />
                    <Input type="date" name="nextActionOn" defaultValue={o.next_action_at?.slice(0, 10) ?? ""} className="h-7 w-36 text-xs md:h-7" />
                    <Input name="lostReason" placeholder="Reason if lost" className="h-7 w-32 text-xs md:h-7" />
                    <Input name="actualValue" placeholder="Actual value" className="h-7 w-28 text-xs md:h-7" />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>No opportunities match. The rules under Settings identify them once a day when switched on; a person can add one from any family.</EmptyState>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} qs={qs} />
    </>
  );
}
