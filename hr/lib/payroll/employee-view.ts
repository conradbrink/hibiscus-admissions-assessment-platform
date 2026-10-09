import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { loadRunPayslips, type LoadedRun } from "@/lib/payroll/payslips";

/**
 * The one payslip an employee's cookie names, read under the service role.
 * Only from an approved or locked run: a payslip still being checked is
 * never shown to the person it is for.
 */
export async function payslipForEmployee(admin: AdminClient, payslipId: string): Promise<LoadedRun | null> {
  const { data: slip } = await admin.from("hr_payslips").select("run_id").eq("id", payslipId).maybeSingle();
  if (!slip) return null;
  const loaded = await loadRunPayslips(admin, slip.run_id, { payslipId });
  if (!loaded || !loaded.slips.length) return null;
  if (loaded.run.status !== "approved" && loaded.run.status !== "locked") return null;
  return loaded;
}
