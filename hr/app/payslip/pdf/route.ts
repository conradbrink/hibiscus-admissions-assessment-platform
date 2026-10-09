import { payslipForEmployee } from "@/lib/payroll/employee-view";
import { renderPayslipsPdf } from "@/lib/payroll/payslips";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPayslipSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await readPayslipSession();
  if (!session) return Response.redirect(new URL("/payslip/expired", request.url), 303);
  const loaded = await payslipForEmployee(createAdminClient(), session.payslipId);
  if (!loaded) return Response.redirect(new URL("/payslip/expired", request.url), 303);
  const buffer = await renderPayslipsPdf(loaded);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="payslip-${loaded.run.period}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
