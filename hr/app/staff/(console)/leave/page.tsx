import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { formatDate, hoursAgoIso } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { decideLeaveAction } from "../employees/actions";

export const metadata = { title: "Leave" };

export default async function LeavePage() {
  const ctx = await requireStaff("hr.leave.approve");
  const today = hoursAgoIso(0).slice(0, 10);
  const in30 = hoursAgoIso(-30 * 24).slice(0, 10);
  const [{ data: pending }, { data: upcoming }, { data: types }] = await Promise.all([
    ctx.supabase.from("hr_leave_requests").select("*").eq("status", "pending").order("starts_on"),
    ctx.supabase.from("hr_leave_requests").select("*").eq("status", "approved").gte("ends_on", today).lte("starts_on", in30).order("starts_on"),
    ctx.supabase.from("hr_leave_types").select("code, name"),
  ]);
  const ids = [...new Set([...(pending ?? []), ...(upcoming ?? [])].map((r) => r.employee_id))];
  const { data: employees } = ids.length ? await ctx.supabase.from("hr_employees").select("id, first_name, last_name, position_title").in("id", ids) : { data: [] };
  const person = new Map((employees ?? []).map((e) => [e.id, e]));
  const typeName = new Map((types ?? []).map((t) => [t.code, t.name]));
  const dates = (r: { starts_on: string; ends_on: string }) => (r.starts_on === r.ends_on ? formatDate(r.starts_on) : `${formatDate(r.starts_on)} to ${formatDate(r.ends_on)}`);

  return (
    <>
      <PageTitle title="Leave" description="Requests waiting for a decision, and who is away in the next 30 days. To record new leave, open the person's page." />

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">
          Waiting for a decision <span className="text-muted-foreground tabular-nums">({pending?.length ?? 0})</span>
        </h2>
        {pending?.length ? (
          <ul className="space-y-2">
            {pending.map((r) => {
              const e = person.get(r.employee_id);
              return (
                <li key={r.id} className="surface flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <Link href={`/staff/employees/${r.employee_id}#leave`} className="font-semibold hover:text-primary hover:underline">
                      {e ? `${e.first_name} ${e.last_name}` : "Employee"}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {typeName.get(r.leave_type_code) ?? r.leave_type_code}, {dates(r)} ({r.days} {Number(r.days) === 1 ? "day" : "days"})
                    </p>
                    {r.reason ? <p className="mt-0.5 text-sm">{r.reason}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <ActionForm action={decideLeaveAction.bind(null, r.id)} label="Approve" size="sm" className="space-y-1">
                      <input type="hidden" name="decision" value="approved" />
                      <input type="hidden" name="notify" value="on" />
                    </ActionForm>
                    <ActionForm action={decideLeaveAction.bind(null, r.id)} label="Decline" size="sm" variant="outline" className="flex items-end gap-2 space-y-0">
                      <input type="hidden" name="decision" value="declined" />
                      <input type="hidden" name="notify" value="on" />
                      <Input name="note" placeholder="Reason (sent to them)" aria-label="Reason for declining" className="h-8 w-52" />
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>Nothing waiting. Every request has a decision.</EmptyState>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Away in the next 30 days</h2>
        {upcoming?.length ? (
          <div className="surface overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th className="text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => {
                  const e = person.get(r.employee_id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/staff/employees/${r.employee_id}#leave`} className="font-medium hover:text-primary hover:underline">
                          {e ? `${e.first_name} ${e.last_name}` : "Employee"}
                        </Link>
                        {e ? <span className="block text-xs text-muted-foreground">{e.position_title}</span> : null}
                      </td>
                      <td>{typeName.get(r.leave_type_code) ?? r.leave_type_code}</td>
                      <td className="tabular-nums">
                        {dates(r)} {r.starts_on <= today ? <Pill tone="info">Away now</Pill> : null}
                      </td>
                      <td className="text-right tabular-nums">{r.days}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nobody has approved leave in the next 30 days.</EmptyState>
        )}
      </section>
    </>
  );
}
