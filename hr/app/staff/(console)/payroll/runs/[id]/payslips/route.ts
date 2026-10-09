import { z } from "zod";
import { audit, staffActor } from "@/lib/audit";
import { loadRunPayslips, renderPayslipsPdf } from "@/lib/payroll/payslips";
import { getStaff } from "@/lib/staff/session";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The month's payslips as one PDF, one page each, for printing. `?employee=`
 * narrows it to one person. Read through the person's own client, so the
 * strict pay policy decides what is in it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ctx = await getStaff();
  if (!ctx || !can(ctx.permissions, "hr.payroll.read")) return new Response("Not found", { status: 404 });
  const employee = new URL(request.url).searchParams.get("employee");
  const employeeIds = employee && z.string().uuid().safeParse(employee).success ? [employee] : undefined;
  const loaded = await loadRunPayslips(ctx.supabase, z.string().uuid().parse(id), { employeeIds });
  if (!loaded || !loaded.slips.length) return new Response("Not found", { status: 404 });
  await audit(createAdminClient(), staffActor(ctx), {
    action: "payslips_printed",
    entityType: "hr_payroll_run",
    entityId: loaded.run.id,
    campusId: loaded.run.campus_id,
    sensitivity: "compensation",
    after: { count: loaded.slips.length, employee: employeeIds?.[0] ?? null },
  });
  const buffer = await renderPayslipsPdf(loaded);
  const name = employeeIds ? loaded.slips[0].snapshot.employee_number : loaded.campus.name.replace(/[^A-Za-z0-9]+/g, "-");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="payslips-${loaded.run.period}-${name}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
