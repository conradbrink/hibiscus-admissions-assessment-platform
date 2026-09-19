import Link from "next/link";
import { Ago, LifecycleBadge, Pagination, Pill, queryBuilder, Tags } from "@/components/crm/bits";
import { CampusPicker } from "@/components/crm/campus-picker";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { listFamilies, type FamilyListFilters } from "@/lib/crm/families";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

type Search = { q?: string; campus?: string; lifecycle?: string; grade?: string; student?: string; source?: string; assigned?: string; opportunity?: string; contact?: string; tag?: string; page?: string };

/**
 * Every family, searchable and filterable, one page at a time. Reads the
 * facts view through the caller's own client, so the count and the rows are
 * what this person may see.
 */
export default async function FamiliesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("crm.read");
  const filters: FamilyListFilters = {
    q: sp.q,
    campus: sp.campus,
    lifecycle: sp.lifecycle,
    grade: sp.grade,
    student: sp.student,
    source: sp.source,
    assigned: sp.assigned === "me" ? userId : sp.assigned,
    opportunity: sp.opportunity,
    contact: sp.contact === "none_30d" || sp.contact === "none_90d" || sp.contact === "follow_up_due" ? sp.contact : undefined,
    tag: sp.tag,
    page: Number(sp.page ?? "1") || 1,
  };
  const [list, { data: campuses }, { data: grades }, { data: staff }, { data: types }] = await Promise.all([
    listFamilies(supabase, filters),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("grades").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  const staffName = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const qs = queryBuilder(sp);

  return (
    <>
      <PageTitle title="Families" description={`${list.total} matching`}>
        <CampusPicker campuses={campuses ?? []} current={sp.campus ?? null} />
        {can(permissions, "crm.write") ? <Link href="/staff/crm/families/new" className={buttonVariants({ size: "lg" })}>Add family</Link> : null}
      </PageTitle>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill href={qs({ lifecycle: undefined, contact: undefined, page: undefined })} active={!sp.lifecycle && !sp.contact}>All</Pill>
        {LIFECYCLE_STAGES.map((s) => (
          <Pill key={s} href={qs({ lifecycle: s, page: undefined })} active={sp.lifecycle === s}>{LIFECYCLE_LABELS[s]}</Pill>
        ))}
        <Pill href={qs({ contact: "follow_up_due", page: undefined })} active={sp.contact === "follow_up_due"}>Follow-up due</Pill>
        <Pill href={qs({ contact: "none_30d", page: undefined })} active={sp.contact === "none_30d"}>No contact 30 days</Pill>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {sp.campus ? <input type="hidden" name="campus" value={sp.campus} /> : null}
        {sp.lifecycle ? <input type="hidden" name="lifecycle" value={sp.lifecycle} /> : null}
        {sp.contact ? <input type="hidden" name="contact" value={sp.contact} /> : null}
        <Input name="q" placeholder="Family, parent, child, phone, email, code" defaultValue={sp.q ?? ""} className="w-64" />
        <NativeSelect name="grade" defaultValue={sp.grade ?? ""} className="w-40" aria-label="Grade">
          <option value="">Any grade</option>
          {(grades ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </NativeSelect>
        <NativeSelect name="source" defaultValue={sp.source ?? ""} className="w-44" aria-label="Lead source">
          <option value="">Any source</option>
          {HEARD_FROM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect name="assigned" defaultValue={sp.assigned ?? ""} className="w-44" aria-label="Assigned to">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </NativeSelect>
        <NativeSelect name="opportunity" defaultValue={sp.opportunity ?? ""} className="w-44" aria-label="Open opportunity">
          <option value="">Any opportunity</option>
          {(types ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </NativeSelect>
        <Input name="tag" placeholder="Tag" defaultValue={sp.tag ?? ""} className="w-32" />
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
        {sp.q || sp.grade || sp.source || sp.assigned || sp.opportunity || sp.tag ? <Link href={qs({ q: undefined, grade: undefined, source: undefined, assigned: undefined, opportunity: undefined, tag: undefined, page: undefined })} className="text-xs text-muted-foreground hover:underline">Clear</Link> : null}
      </form>

      {list.rows.length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead>
              <tr>
                <th>Family</th><th>Primary parent</th><th>Students</th><th>Campus</th><th>Lifecycle</th><th>Last contact</th><th>Assigned to</th><th className="text-right">Opportunities</th><th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((f) => (
                <tr key={f.family_id}>
                  <td>
                    <Link href={`/staff/crm/families/${f.family_id}`} className="font-medium hover:underline">{f.display_name ?? f.family_code}</Link>
                    <span className="block text-xs text-muted-foreground">{f.family_code}</span>
                    <Tags tags={f.tags} />
                  </td>
                  <td>
                    {f.primary_first_name ? (
                      <>
                        <Link href={`/staff/crm/contacts/${f.primary_contact_id}`} className="hover:underline">{f.primary_first_name} {f.primary_last_name}</Link>
                        <span className="block text-xs text-muted-foreground">{f.primary_mobile ?? f.primary_email}</span>
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="tabular-nums">{f.enrolled_count}<span className="text-muted-foreground"> / {f.student_count}</span></td>
                  <td className="text-xs">{f.campus_name ?? "—"}</td>
                  <td><LifecycleBadge stage={f.lifecycle_stage} /></td>
                  <td className="text-xs"><Ago value={f.last_contact_at} /></td>
                  <td className="text-xs">{f.assigned_staff_id ? staffName.get(f.assigned_staff_id) ?? "—" : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums">{f.open_opportunity_count || <span className="text-muted-foreground">0</span>}</td>
                  <td className="text-xs">{f.next_follow_up_at ? <span className={new Date(f.next_follow_up_at) <= new Date() ? "font-medium text-destructive" : ""}>{f.next_follow_up_at.slice(0, 10)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No families match. A family appears here the moment a parent enquires, or when one is added by hand.</EmptyState>
      )}
      <Pagination page={list.page} pages={list.pages} qs={qs} />
    </>
  );
}
