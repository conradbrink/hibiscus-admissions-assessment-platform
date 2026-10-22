import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { PriorityBadge } from "@/components/staff/status-badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime, hasStarted } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { assignTask } from "../applications/[id]/actions";
import { createTask, markTaskDone, reopenTask } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; type?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId, permissions } = await requireStaff("applications.read");
  const canWrite = can(permissions, "applications.write");
  const canCreate = can(permissions, "tasks.write");
  const now = new Date();
  const archive = sp.filter === "done";

  let query = supabase
    .from("tasks")
    // All three subjects: a task names an applicant, a child, or — for the
    // first-day list and anything staff write themselves — only its campus.
    // Rendering whichever is there is what stops a student task appearing as
    // a title with nothing to click.
    .select(
      "*, applications(id, reference, child_first_name, child_last_name), students(id, legal_first_name, legal_last_name, preferred_name, student_code), campuses(name), staff_profiles!tasks_assignee_staff_id_fkey(full_name)"
    )
    // The archive reads newest first; the open list, soonest due first.
    .order(archive ? "resolved_at" : "due_at", archive ? { ascending: false } : { ascending: true, nullsFirst: false })
    .limit(200);

  // A task ticked off leaves the list at once and is kept in the archive
  // (the Done tab), where it can be reopened. It used to stay on the open
  // list, struck through, for a week, so the list never got shorter as work
  // was done; the school asked on 22 October 2026 for done to mean gone.
  query = query.eq("status", archive ? "done" : "open");

  if (sp.filter === "mine") query = query.eq("assignee_staff_id", userId);
  if (sp.filter === "unassigned") query = query.is("assignee_staff_id", null);
  if (sp.filter === "overdue") query = query.eq("status", "open").lt("due_at", now.toISOString());
  if (sp.type) query = query.eq("type", sp.type);

  const [{ data: tasks }, { data: staff }, { data: campuses }] = await Promise.all([
    query,
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
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
      <PageTitle title="Tasks" description={archive ? "Ticked off, newest first. Reopen one to put it back on the list." : "What needs doing, oldest due first."} />

      {/* Writing one down. Its own permission: Management may set a task for
          somebody and may not touch an applicant. */}
      {canCreate ? (
        <section className="mb-5 surface p-4">
          <h2 className="text-sm font-semibold">Add a task</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Everyone can see it. Whoever it is for can tick it off, and so can you.
          </p>
          <ActionForm action={createTask} label="Add task" size="sm" className="mt-3 space-y-2">
            <Input name="title" placeholder="What needs doing" required minLength={3} maxLength={200} />
            <Input name="details" placeholder="Any detail (optional)" maxLength={2000} />
            <div className="grid gap-2 sm:grid-cols-4">
              <NativeSelect name="campusId" defaultValue="" required aria-label="Which campus">
                <option value="" disabled>Which campus</option>
                {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
              <NativeSelect name="assigneeStaffId" defaultValue="" aria-label="Who it is for">
                {/* Left blank, the database gives it to the campus owner
                    (tasks_set_default_assignee), so say so. */}
                <option value="">Campus owner (automatic)</option>
                {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </NativeSelect>
              <Input type="date" name="dueOn" aria-label="Due on" />
              <NativeSelect name="priority" defaultValue="normal" aria-label="Priority">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </NativeSelect>
            </div>
          </ActionForm>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {tab(undefined, "All open")}
        {tab("mine", "Mine")}
        {tab("unassigned", "Unassigned")}
        {tab("overdue", "Overdue")}
        {tab("done", "Archive")}
      </div>

      {/* A link from the dashboard narrows to one kind of open task and
          matches no tab, so say what the list holds and the way back. */}
      {sp.filter === "open" || sp.type ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Only {sp.filter === "open" ? "open " : ""}tasks{sp.type ? ` of type “${sp.type.replace(/_/g, " ")}”` : ""}, as counted on the dashboard.{" "}
          <Link href="/staff/tasks" className="text-primary underline underline-offset-2">Show all tasks</Link>
        </p>
      ) : null}

      {tasks && tasks.length > 0 ? (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const app = one(t.applications);
            const student = one(t.students);
            const campus = one(t.campuses);
            const assignee = one(t.staff_profiles);
            const isDone = t.status === "done";
            const overdue = !isDone && t.due_at ? hasStarted(t.due_at) : false;
            const mine = t.assignee_staff_id === userId;
            // The assignee always may; anybody who writes tasks or edits
            // applicants may cover for somebody who is away.
            const canTick = mine || canCreate || canWrite;
            return (
              <li
                key={t.id}
                className={`flex flex-wrap items-center gap-3 surface px-4 py-3 text-sm ${isDone ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${isDone ? "line-through" : ""}`}>{t.title}</p>
                  {t.details ? (
                    <p className={`whitespace-pre-line text-xs text-muted-foreground ${isDone ? "line-through" : ""}`}>{t.details}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {app ? (
                      <Link href={`/staff/applications/${app.id}`} className="underline">
                        {app.child_first_name} {app.child_last_name} · {app.reference}
                      </Link>
                    ) : student ? (
                      <Link href={`/staff/students/${student.id}`} className="underline">
                        {student.preferred_name || student.legal_first_name} {student.legal_last_name} · {student.student_code}
                      </Link>
                    ) : null}
                    {/* Which school. With nine campuses a task list without it
                        is a list nobody can triage. */}
                    {campus ? <span className={app || student ? "ml-2" : undefined}>{campus.name}</span> : null}
                    {isDone ? (
                      <span className="ml-2">Done{t.resolved_at ? ` ${formatDateTime(t.resolved_at)}` : ""}</span>
                    ) : t.due_at ? (
                      <span className={overdue ? " ml-2 font-medium text-destructive" : " ml-2"}>Due {formatDateTime(t.due_at)}</span>
                    ) : null}
                  </p>
                </div>
                {!isDone ? <PriorityBadge priority={t.priority} /> : null}
                {/* Said out loud as well as set in the picker: the picker is a
                    control, and a control is not a statement of fact. */}
                <span className="text-xs text-muted-foreground">{assignee?.full_name ?? "Unassigned"}</span>
                {isDone ? (
                  canTick ? (
                    <ActionForm action={reopenTask} label="Reopen" size="xs" variant="ghost">
                      <input type="hidden" name="taskId" value={t.id} />
                    </ActionForm>
                  ) : null
                ) : (
                  <>
                    {canWrite || canCreate ? (
                      <ActionForm action={assignTask} label="Assign" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                        <input type="hidden" name="taskId" value={t.id} />
                        {app ? <input type="hidden" name="applicationId" value={app.id} /> : null}
                        <NativeSelect name="assigneeStaffId" defaultValue={t.assignee_staff_id ?? ""} className="h-7 w-40 py-0 text-xs md:h-7">
                          <option value="">Unassigned</option>
                          {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </NativeSelect>
                      </ActionForm>
                    ) : null}
                    {canTick ? (
                      <ActionForm action={markTaskDone} label="Done" size="xs" variant="success">
                        <input type="hidden" name="taskId" value={t.id} />
                      </ActionForm>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>{archive ? "Nothing has been ticked off yet." : "Nothing open."}</EmptyState>
      )}
    </>
  );
}
