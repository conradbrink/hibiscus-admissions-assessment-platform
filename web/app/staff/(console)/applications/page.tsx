import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { isNextAction, NEXT_ACTIONS, PIPELINE_GROUPS, STATUS_LABELS } from "@/lib/workflow/states";

type Search = {
  q?: string;
  status?: string;
  group?: string;
  campus?: string;
  mine?: string;
  page?: string;
};

const PAGE = 50;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireStaff("applications.read");

  const group = PIPELINE_GROUPS.find((g) => g.key === sp.group);
  const statuses: ApplicationStatus[] | null = sp.status
    ? [sp.status as ApplicationStatus]
    : group
      ? [...group.statuses]
      : null;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  let query = supabase
    .from("applications")
    .select(
      "id, reference, child_first_name, child_last_name, status, next_action, next_action_due_at, created_at, owner_staff_id, campuses(name), grades!applications_grade_id_fkey(name), contacts(first_name, last_name, email), staff_profiles!applications_owner_staff_id_fkey(full_name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (statuses) query = query.in("status", statuses);
  else query = query.neq("status", "withdrawn");
  if (sp.campus) query = query.eq("campus_id", sp.campus);
  if (sp.mine === "1") query = query.eq("owner_staff_id", userId);
  if (sp.q) {
    const q = sp.q.trim();
    query = query.or(
      `reference.ilike.%${q}%,child_first_name.ilike.%${q}%,child_last_name.ilike.%${q}%`
    );
  }

  const [{ data: rows, count, error }, { data: campuses }, { data: pipeline }] = await Promise.all([
    query,
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("v_pipeline_counts").select("status, applications"),
  ]);
  if (error) throw new Error(error.message);

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const countByStatus = new Map<string, number>();
  for (const r of pipeline ?? []) countByStatus.set(r.status, (countByStatus.get(r.status) ?? 0) + r.applications);
  const groupCount = (keys: readonly ApplicationStatus[]) => keys.reduce((n, s) => n + (countByStatus.get(s) ?? 0), 0);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <PageTitle title="Applicants" description={`${total} matching`} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={qs({ group: undefined, status: undefined, page: undefined })} className={`rounded-full border px-3 py-1 text-xs ${!sp.group && !sp.status ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
          All active
        </Link>
        {PIPELINE_GROUPS.map((g) => (
          <Link
            key={g.key}
            href={qs({ group: g.key, status: undefined, page: undefined })}
            className={`rounded-full border px-3 py-1 text-xs ${sp.group === g.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
          >
            {g.label} <span className="opacity-70">{groupCount(g.statuses)}</span>
          </Link>
        ))}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {sp.group ? <input type="hidden" name="group" value={sp.group} /> : null}
        <Input name="q" placeholder="Search name or reference" defaultValue={sp.q ?? ""} className="w-56" />
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-52">
          <option value="">Any status{sp.group ? " in group" : ""}</option>
          {(group ? group.statuses : (Object.keys(STATUS_LABELS) as ApplicationStatus[])).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </NativeSelect>
        <label className="flex h-9 items-center gap-1.5 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> Mine
        </label>
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
      </form>

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Child</th>
                <th className="px-3 py-2 font-medium">Parent</th>
                <th className="px-3 py-2 font-medium">Campus · Grade</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Next action</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Enquired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const campus = one(r.campuses);
                const grade = one(r.grades);
                const contact = one(r.contacts);
                const owner = one(r.staff_profiles);
                const na = isNextAction(r.next_action) ? NEXT_ACTIONS[r.next_action].staffLabel : "—";
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link href={`/staff/applications/${r.id}`} className="font-medium hover:underline">
                        {r.child_first_name} {r.child_last_name}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">{r.reference}</span>
                    </td>
                    <td className="px-3 py-2">
                      {contact?.first_name} {contact?.last_name}
                      <span className="block text-xs text-muted-foreground">{contact?.email}</span>
                    </td>
                    <td className="px-3 py-2">{campus?.name} · {grade?.name}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">
                      {na}
                      {r.next_action_due_at ? <span className="block text-xs text-muted-foreground">by {formatDateTime(r.next_action_due_at)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{owner?.full_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No applicants match.</EmptyState>
      )}

      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-3">
            {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="underline">Previous</Link> : null}
            {page < pages ? <Link href={qs({ page: String(page + 1) })} className="underline">Next</Link> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
