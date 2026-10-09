import Link from "next/link";
import { Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { NativeSelect } from "@/components/ui/native-select";
import { buttonVariants } from "@/components/ui/button";
import { CATEGORY_LABEL, OUTCOME_LABEL, STATUS_LABEL } from "@/lib/disciplinary";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Disciplinary" };

export default async function DisciplinaryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireStaff("hr.disciplinary.read");
  const show = (await searchParams).show === "all" ? "all" : "open";
  let q = ctx.supabase.from("hr_disciplinary_cases").select("*").order("opened_at", { ascending: false }).limit(200);
  if (show === "open") q = q.neq("status", "closed");
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: cases }, { data: warnings }] = await Promise.all([q, ctx.supabase.from("hr_warnings").select("employee_id").gte("expires_on", today)]);
  const ids = [...new Set((cases ?? []).map((c) => c.employee_id))];
  const { data: employees } = ids.length ? await ctx.supabase.from("hr_employees").select("id, first_name, last_name, position_title").in("id", ids) : { data: [] };
  const person = new Map((employees ?? []).map((e) => [e.id, e]));

  return (
    <>
      <PageTitle
        title="Disciplinary"
        description={`Cases, hearings and warnings. ${warnings?.length ?? 0} ${warnings?.length === 1 ? "warning is" : "warnings are"} in force. To open a case, go to the person's page.`}
      >
        <form className="flex items-center gap-2">
          <NativeSelect name="show" defaultValue={show} aria-label="Which cases">
            <option value="open">Open cases</option>
            <option value="all">All cases</option>
          </NativeSelect>
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Show</button>
        </form>
      </PageTitle>
      {cases?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Employee</th>
                <th>Opened</th>
                <th>Status</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const e = person.get(c.employee_id);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/staff/disciplinary/cases/${c.id}`} className="font-semibold hover:text-primary hover:underline">
                        {c.summary}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{CATEGORY_LABEL[c.category]}</span>
                    </td>
                    <td>{e ? `${e.first_name} ${e.last_name}` : ""}</td>
                    <td className="tabular-nums">{formatDate(c.opened_at)}</td>
                    <td>
                      <Pill tone={c.status === "closed" ? "muted" : "info"}>{STATUS_LABEL[c.status]}</Pill>
                    </td>
                    <td>{c.outcome ? OUTCOME_LABEL[c.outcome] : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>{show === "open" ? "No open cases." : "No cases yet."}</EmptyState>
      )}
    </>
  );
}
