import { z } from "zod";
import { audit, staffActor } from "@/lib/audit";
import { bankFile, journal, statutory } from "@/lib/payroll/exports";
import { loadRunPayslips, toExportSlips } from "@/lib/payroll/payslips";
import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["bank", "journal", "tax"] as const;

/**
 * The month's files: the bank payment file, the journal for the accounts and
 * the tax totals. Only for an approved run, and only with the export
 * permission as well as payroll access. The bank file reads the current
 * account numbers, which only payroll people can see.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; kind: string }> }): Promise<Response> {
  const { id, kind } = await params;
  const ctx = await getStaff();
  if (!ctx || !can(ctx.permissions, "hr.payroll.read") || !can(ctx.permissions, "hr.export")) return new Response("Not found", { status: 404 });
  const k = z.enum(KINDS).safeParse(kind);
  if (!k.success) return new Response("Not found", { status: 404 });
  const loaded = await loadRunPayslips(ctx.supabase, z.string().uuid().parse(id));
  if (!loaded) return new Response("Not found", { status: 404 });
  if (loaded.run.status !== "approved" && loaded.run.status !== "locked") return new Response("This run is not approved yet.", { status: 409 });

  const slips = toExportSlips(loaded);
  let csv: string;
  if (k.data === "bank") {
    const { data: banks } = await ctx.supabase
      .from("hr_employee_bank")
      .select("*")
      .in("employee_id", loaded.slips.map((s) => s.employee_id));
    const bankFor = new Map((banks ?? []).map((b) => [b.employee_id, b]));
    csv = bankFile(
      loaded.slips.map((s, i) => {
        const b = bankFor.get(s.employee_id);
        return { ...slips[i], bank: b ? { bankName: b.bank_name, branchCode: b.branch_code, accountName: b.account_name, accountNumber: b.account_number } : null };
      }),
      `Salary ${loaded.run.period}`
    );
  } else if (k.data === "journal") {
    csv = journal(slips, loaded.run.currency);
  } else {
    csv = statutory(slips, loaded.run.country);
  }
  await audit(createAdminClient(), staffActor(ctx), {
    action: `payroll_export_${k.data}`,
    entityType: "hr_payroll_run",
    entityId: loaded.run.id,
    campusId: loaded.run.campus_id,
    sensitivity: "compensation",
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${k.data}-${loaded.run.period}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
