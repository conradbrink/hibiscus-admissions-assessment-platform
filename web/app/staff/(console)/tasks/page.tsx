import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { PriorityBadge } from "@/components/staff/status-badge";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime, hasStarted } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { assignTask, completeTask } from "../applications/[id]/actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; type?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("applications.read");
  const canWrite = can(permissions, "applications.write");

  let query = supabase
    .from("tasks")
    .select("*, applications(id, reference, child_first_name, child_last_name), staff_profiles!tasks_assignee_staff_id_fkey(full_name)")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (sp.filter === "mine") query = query.eq("assignee_staff_id", userId);
  if (sp.filter === "unassigned") query = query.is("assignee_staff_id", null);
  if (sp.filter === "overdue") query = query.lt("due_at", new Date().toISOString());
  if (sp.type) query = query.eq("type", sp.type);

  const [{ data: tasks }, { data: staff }] = await Promise.all([
    query,
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const tab = (key: string | undefined, label: string) => (
    <Link
      href={key ? `?filter=${key}` : "?"}
      className={`rounded-full border px-3 py-1 text-xs ${(sp.filter ?? "") === (key ?? "") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageTitle title="Tasks" description="What needs doing, oldest due first." />
      <div className="mb-4 flex gap-1.5">
        {tab(undefined, "All open")}
        {tab("mine", "Mine")}
        {tab("unassigned", "Unassigned")}
        {tab("overdue", "Overdue")}
      </div>
      {tasks && tasks.length > 0 ? (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const app = one(t.applications);
            const assignee = one(t.staff_profiles);
            const overdue = t.due_at ? hasStarted(t.due_at) : false;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  {t.details ? <p className="text-xs text-muted-foreground">{t.details}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {app ? (
                      <Link href={`/staff/applications/${app.id}`} className="underline">
                        {app.child_first_name} {app.child_last_name} · {app.reference}
                      </Link>
                    ) : null}
                    {t.due_at ? <span className={overdue ? " ml-2 font-medium text-destructive" : " ml-2"}>Due {formatDateTime(t.due_at)}</span> : null}
                  </p>
                </div>
                <PriorityBadge priority={t.priority} />
                {canWrite ? (
                  <>
                    <ActionForm action={assignTask} label="Assign" size="xs" variant="outline" className="flex items-center gap-1 space-y-0">
                      <input type="hidden" name="taskId" value={t.id} />
                      {app ? <input type="hidden" name="applicationId" value={app.id} /> : null}
                      <NativeSelect name="assigneeStaffId" defaultValue={t.assignee_staff_id ?? ""} className="h-7 w-40 py-0 text-xs md:h-7">
                        <option value="">Unassigned</option>
                        {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </NativeSelect>
                    </ActionForm>
                    <ActionForm action={completeTask} label="Done" size="xs" variant="success">
                      <input type="hidden" name="taskId" value={t.id} />
                      {app ? <input type="hidden" name="applicationId" value={app.id} /> : null}
                    </ActionForm>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{assignee?.full_name ?? "Unassigned"}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>Nothing open.</EmptyState>
      )}
    </>
  );
}
