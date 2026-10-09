import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Field, Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/money";
import { periodLabel, periodOf } from "@/lib/payroll/period";
import { readTotals } from "@/lib/payroll/run";
import { can } from "@/lib/permissions";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { createRunAction } from "./actions";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const ctx = await requireStaff("hr.payroll.read");
  const [{ data: runs }, campuses] = await Promise.all([
    ctx.supabase.from("hr_payroll_runs").select("*").order("period", { ascending: false }).limit(60),
    accessibleCampuses(ctx.supabase),
  ]);
  const campusName = new Map(campuses.map((c) => [c.id, c.name]));
  const thisMonth = periodOf(new Date());

  return (
    <>
      <PageTitle
        title="Payroll"
        description="One run for each school, each month. Fill in the timesheet, work out the pay, check it, then a second person approves it."
      />

      {can(ctx.permissions, "hr.payroll.prepare") ? (
        <ActionForm action={createRunAction} label="Start payroll" className="surface mb-6 grid items-end gap-4 p-5 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="School" htmlFor="campus_id">
            <NativeSelect id="campus_id" name="campus_id" required>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Month" htmlFor="period">
            <Input id="period" name="period" type="month" defaultValue={thisMonth} required />
          </Field>
        </ActionForm>
      ) : null}

      {runs?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>School</th>
                <th className="text-right">People</th>
                <th className="text-right">Total net pay</th>
                <th className="text-right">Cost to the school</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const t = readTotals(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/staff/payroll/runs/${r.id}`} className="font-semibold hover:text-primary hover:underline">
                        {periodLabel(r.period)}
                      </Link>
                    </td>
                    <td>{campusName.get(r.campus_id) ?? ""}</td>
                    <td className="text-right tabular-nums">{t?.employees ?? ""}</td>
                    <td className="text-right tabular-nums">{t ? formatMoney(t.netMinor, r.currency) : ""}</td>
                    <td className="text-right tabular-nums">{t ? formatMoney(t.employerCostMinor, r.currency) : ""}</td>
                    <td>
                      <Pill tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No payroll yet. Choose a school and a month above to start the first one.</EmptyState>
      )}
    </>
  );
}
