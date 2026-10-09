import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { employedDuring, isPeriod, periodLabel, periodOf, shiftPeriod } from "@/lib/payroll/period";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import { cn } from "@/lib/utils";
import { approveTimesheetAction, reopenTimesheetAction, saveTimesheetAction } from "./actions";

export const metadata = { title: "Timesheets" };

const COLUMNS = [
  ["days_worked", "Days worked", "0.5"],
  ["normal_hours", "Normal hours", "0.25"],
  ["overtime_hours", "Overtime hours", "0.25"],
  ["sunday_hours", "Sunday hours", "0.25"],
  ["public_holiday_hours", "Public holiday hours", "0.25"],
  ["unpaid_days", "Unpaid days", "0.5"],
] as const;

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ campus?: string; period?: string }> }) {
  const ctx = await requireStaff("hr.timesheets.write");
  const sp = await searchParams;
  const campuses = await accessibleCampuses(ctx.supabase);
  const campus = campuses.find((c) => c.id === sp.campus) ?? campuses[0];
  const period = sp.period && isPeriod(sp.period) ? sp.period : periodOf(new Date());
  if (!campus) return <EmptyState>You do not have access to any school.</EmptyState>;

  const [{ data: employees }, { data: sheet }] = await Promise.all([
    ctx.supabase.from("hr_employees").select("id, first_name, last_name, employee_number, position_title, start_date, end_date").eq("campus_id", campus.id).order("last_name"),
    ctx.supabase.from("hr_timesheet_periods").select("*").eq("campus_id", campus.id).eq("period", period).maybeSingle(),
  ]);
  const { data: entries } = sheet ? await ctx.supabase.from("hr_timesheet_entries").select("*").eq("period_id", sheet.id) : { data: [] };
  const entryFor = new Map((entries ?? []).map((e) => [e.employee_id, e]));
  const people = (employees ?? []).filter((e) => employedDuring(e, period));
  const approved = sheet?.status === "approved";
  const href = (p: string) => `/staff/timesheets?campus=${campus.id}&period=${p}`;

  return (
    <>
      <PageTitle
        title="Timesheets"
        description="Enter extra hours and unpaid days for the month. People on a monthly salary only need a row if something was different. People paid by the hour need their hours."
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <NativeSelect name="campus" defaultValue={campus.id} aria-label="School">
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
          <Input name="period" type="month" defaultValue={period} aria-label="Month" className="w-44" />
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Show</button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          <Link href={href(shiftPeriod(period, -1))} className="rounded-full px-3 py-1.5 font-medium text-primary hover:bg-muted">
            Previous month
          </Link>
          <span className="font-semibold">{periodLabel(period)}</span>
          <Link href={href(shiftPeriod(period, 1))} className="rounded-full px-3 py-1.5 font-medium text-primary hover:bg-muted">
            Next month
          </Link>
        </div>
      </div>

      <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="text-sm">
          {campus.name}, {periodLabel(period)}:{" "}
          {approved ? <Pill tone="success">Approved</Pill> : sheet ? <Pill tone="warning">Open</Pill> : <Pill>Not started</Pill>}
        </p>
        {approved ? (
          <ActionForm action={reopenTimesheetAction.bind(null, campus.id, period)} label="Reopen to make changes" variant="outline" size="sm" />
        ) : sheet ? (
          <ActionForm action={approveTimesheetAction.bind(null, campus.id, period)} label="Approve timesheet" size="sm" confirm="Approve this timesheet? Payroll will use these hours." />
        ) : null}
      </div>

      {people.length ? (
        <ActionForm action={saveTimesheetAction.bind(null, campus.id, period)} label="Save timesheet" size="lg" resetOnSubmit={false} className="space-y-4">
          <fieldset disabled={approved} className="surface overflow-x-auto">
            <legend className="sr-only">Hours for {periodLabel(period)}</legend>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {COLUMNS.map(([, label]) => (
                    <th key={label} className="text-right">{label}</th>
                  ))}
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const e = entryFor.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="min-w-48">
                        <span className="font-semibold">
                          {p.first_name} {p.last_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">{p.position_title}</span>
                      </td>
                      {COLUMNS.map(([name, label, step]) => (
                        <td key={name} className="text-right">
                          <Input
                            name={`${name}:${p.id}`}
                            type="number"
                            min={0}
                            step={step}
                            defaultValue={e ? String(Number(e[name]) || "") : ""}
                            aria-label={`${label} for ${p.first_name} ${p.last_name}`}
                            className="ml-auto h-8 w-20 text-right tabular-nums"
                          />
                        </td>
                      ))}
                      <td>
                        <Input name={`notes:${p.id}`} defaultValue={e?.notes ?? ""} aria-label={`Note for ${p.first_name} ${p.last_name}`} className="h-8 min-w-40" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </fieldset>
          <p className="text-xs text-muted-foreground">Overtime is paid at 1.5 times the hourly rate. Sunday and public holiday hours are paid at 2 times. Unpaid days are taken off a monthly salary.</p>
        </ActionForm>
      ) : (
        <EmptyState>Nobody at {campus.name} was employed in {periodLabel(period)}.</EmptyState>
      )}
    </>
  );
}
