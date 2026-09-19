import Link from "next/link";
import { Pill, queryBuilder } from "@/components/crm/bits";
import { CampusPicker } from "@/components/crm/campus-picker";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { PriorityBadge } from "@/components/staff/status-badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime, hasStarted, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { completeCrmTask, updateCrmTask } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The CRM's view of the one task list: mine, today, overdue, upcoming, the
 * team's. The same rows the admissions console shows; the CRM adds the
 * family each task belongs to, which is what a person here is working by.
 */
export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; campus?: string; family?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const filter = sp.filter ?? "mine";
  const now = new Date();
  const today = toSchoolDateString(now);
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);

  let q = supabase
    .from("tasks")
    .select("*, applications(id, reference, child_first_name, child_last_name, contacts!applications_contact_id_fkey(family_id)), students(id, legal_first_name, legal_last_name, preferred_name, family_id), campuses(name), staff_profiles!tasks_assignee_staff_id_fkey(full_name)")
    .eq("status", filter === "done" ? "done" : "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(300);
  if (sp.campus) q = q.eq("campus_id", sp.campus);
  if (filter === "mine") q = q.eq("assignee_staff_id", userId);
  if (filter === "today") q = q.gte("due_at", `${today}T00:00:00+02:00`).lt("due_at", `${today}T23:59:59+02:00`);
  if (filter === "overdue") q = q.lt("due_at", now.toISOString());
  if (filter === "upcoming") q = q.gt("due_at", now.toISOString()).lte("due_at", weekEnd.toISOString());
  if (filter === "unassigned") q = q.is("assignee_staff_id", null);

  const [{ data: tasksRaw }, { data: staff }, { data: campuses }] = await Promise.all([
    q,
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
  ]);
  const withFamily = (tasksRaw ?? []).map((t) => ({ ...t, familyId: one(t.students)?.family_id ?? one(one(t.applications)?.contacts)?.family_id ?? null }));
  const tasks = sp.family ? withFamily.filter((t) => t.familyId === sp.family) : withFamily;
  const familyIds = [...new Set(tasks.map((t) => t.familyId).filter((x): x is string => !!x))];
  const { data: families } = familyIds.length ? await supabase.from("families").select("id, display_name, family_code").in("id", familyIds.slice(0, 300)) : { data: [] };
  const familyOf = new Map((families ?? []).map((f) => [f.id, f]));
  const qs = queryBuilder(sp);

  return (
    <>
      <PageTitle title="Tasks" description="What needs doing about families, oldest due first. Add one from a family's page.">
        <CampusPicker campuses={campuses ?? []} current={sp.campus ?? null} />
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["mine", "My tasks"], ["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["team", "Team tasks"], ["unassigned", "Unassigned"], ["done", "Done"]].map(([k, label]) => (
          <Pill key={k} href={qs({ filter: k })} active={filter === k}>{label}</Pill>
        ))}
      </div>
      {tasks.length ? (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const fam = t.familyId ? familyOf.get(t.familyId) : null;
            const student = one(t.students);
            const app = one(t.applications);
            const overdue = t.status === "open" && t.due_at ? hasStarted(t.due_at) : false;
            const mine = t.assignee_staff_id === userId;
            return (
              <li key={t.id} className={`surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${t.status === "done" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  {t.details ? <p className="whitespace-pre-line text-xs text-muted-foreground">{t.details}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {fam ? <Link href={`/staff/crm/families/${fam.id}`} className="underline">{fam.display_name ?? fam.family_code} family</Link> : null}
                    {student ? <span> · <Link href={`/staff/students/${student.id}`} className="underline">{student.preferred_name || student.legal_first_name} {student.legal_last_name}</Link></span> : app ? <span> · <Link href={`/staff/applications/${app.id}`} className="underline">{app.child_first_name} {app.child_last_name}</Link></span> : null}
                    {one(t.campuses) ? <span> · {one(t.campuses)!.name}</span> : null}
                    {t.due_at ? <span className={overdue ? " ml-2 font-medium text-destructive" : " ml-2"}>Due {formatDateTime(t.due_at)}</span> : null}
                    {t.status === "done" && t.resolved_at ? <span className="ml-2">Done {formatDateTime(t.resolved_at)}</span> : null}
                  </p>
                </div>
                {t.status === "open" ? <PriorityBadge priority={t.priority} /> : null}
                <span className="text-xs text-muted-foreground">{one(t.staff_profiles)?.full_name ?? "Unassigned"}</span>
                {t.status === "open" && canWrite ? (
                  <ActionForm action={updateCrmTask} label="Save" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                    <input type="hidden" name="taskId" value={t.id} />
                    <NativeSelect name="assigneeStaffId" defaultValue={t.assignee_staff_id ?? ""} className="h-7 w-36 py-0 text-xs md:h-7" aria-label="Assign">
                      <option value="">Unassigned</option>
                      {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </NativeSelect>
                    <Input type="date" name="dueOn" defaultValue={t.due_at?.slice(0, 10) ?? ""} className="h-7 w-34 text-xs md:h-7" />
                  </ActionForm>
                ) : null}
                {t.status === "open" && (mine || canWrite) ? (
                  <ActionForm action={completeCrmTask} label="Done" size="xs" variant="success">
                    <input type="hidden" name="taskId" value={t.id} />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>{filter === "done" ? "Nothing ticked off yet." : filter === "mine" ? "Nothing assigned to you." : "Nothing here."}</EmptyState>
      )}
    </>
  );
}
