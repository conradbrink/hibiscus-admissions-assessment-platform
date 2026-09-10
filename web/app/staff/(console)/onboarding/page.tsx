import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate, toSchoolDateString } from "@/lib/format-date";
import { isOverdue, isSettled, onboardingProgress, type StepLike } from "@/lib/onboarding/progress";
import { requireStaff } from "@/lib/staff/session";
import { studentName } from "@/lib/students/labels";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Who is still missing what, overdue first.
 *
 * The board answers the question a person actually has on a Monday morning:
 * which families do I ring today. So it sorts by what is late rather than by
 * name, and it shows the school's own unfinished steps beside the families'
 * — "allocate the class" being three weeks overdue is the school's problem
 * and should not hide behind a family's.
 */
export default async function OnboardingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string }>;
}) {
  const { supabase } = await requireStaff("students.read");
  const params = await searchParams;
  const today = toSchoolDateString(new Date());

  const [{ data: steps }, { data: campuses }] = await Promise.all([
    supabase.from("onboarding_steps").select("*").order("sort_order"),
    supabase.from("v_accessible_campuses").select("id, name").order("name"),
  ]);

  let query = supabase
    .from("student_onboarding_items")
    .select("*, students(id, legal_first_name, legal_last_name, preferred_name, status), campuses(name)")
    .in("status", ["pending", "in_progress", "blocked"]);
  if (params.campus) query = query.eq("campus_id", params.campus);
  const { data: items } = await query;

  const stepList = (steps ?? []) as StepLike[];
  const byCode = new Map((steps ?? []).map((s) => [s.code, s]));

  // One row per child, not per item: the person ringing wants the family,
  // and then everything outstanding for them in one breath.
  const byStudent = new Map<
    string,
    { name: string; campus: string; rows: NonNullable<typeof items> }
  >();
  for (const i of items ?? []) {
    const student = one(i.students);
    if (!student) continue;
    const entry = byStudent.get(student.id) ?? {
      name: studentName(student),
      campus: one(i.campuses)?.name ?? "—",
      rows: [],
    };
    entry.rows.push(i);
    byStudent.set(student.id, entry);
  }

  const children = [...byStudent.entries()]
    .map(([id, e]) => {
      const progress = onboardingProgress(stepList, e.rows, today);
      return { id, ...e, progress, overdueCount: progress.overdue.length };
    })
    .sort((a, b) => b.overdueCount - a.overdueCount || a.name.localeCompare(b.name));

  const totalOverdue = children.reduce((n, c) => n + c.overdueCount, 0);

  return (
    <>
      <PageTitle
        title="Onboarding"
        description="What each newly enrolled family still owes us, and what we still owe them."
      />

      <form method="get" className="mb-4 flex items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Campus</span>
          <select name="campus" defaultValue={params.campus ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Every campus</option>
            {(campuses ?? []).map((c) => (
              <option key={c.id} value={c.id!}>{c.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">Apply</button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="surface p-3">
          <p className="text-xs text-muted-foreground">Children still onboarding</p>
          <p className="text-2xl font-semibold tabular-nums">{children.length}</p>
        </div>
        <div className="surface p-3">
          <p className="text-xs text-muted-foreground">Overdue items</p>
          <p className="text-2xl font-semibold tabular-nums">{totalOverdue}</p>
        </div>
        <div className="surface p-3">
          <p className="text-xs text-muted-foreground">Outstanding items</p>
          <p className="text-2xl font-semibold tabular-nums">
            {children.reduce((n, c) => n + c.rows.filter((r) => !isSettled(r)).length, 0)}
          </p>
        </div>
      </div>

      {children.length ? (
        <div className="space-y-3">
          {children.map((c) => (
            <div key={c.id} className="surface p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  <Link href={`/staff/students/${c.id}`} className="hover:underline">{c.name}</Link>
                  <span className="ml-2 text-xs text-muted-foreground">{c.campus}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.progress.requiredDone} of {c.progress.requiredTotal} required done
                </p>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {c.rows.map((r) => {
                  const step = byCode.get(r.step_code);
                  const late = isOverdue(r, today);
                  return (
                    <li key={r.id}>
                      <Badge variant={late ? "destructive" : r.status === "blocked" ? "warning" : "muted"}>
                        {step?.label ?? r.step_code}
                        {step?.owner === "staff" ? " · ours" : ""}
                        {r.due_on ? ` · ${formatDate(r.due_on)}` : ""}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>
          Nothing outstanding. Every enrolled child has finished what was asked of them.
        </EmptyState>
      )}
    </>
  );
}
