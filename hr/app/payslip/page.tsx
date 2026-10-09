import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { payslipForEmployee } from "@/lib/payroll/employee-view";
import { periodLabel } from "@/lib/payroll/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPayslipSession } from "@/lib/tokens/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Your payslip", robots: { index: false } };

export default async function PayslipPage() {
  const session = await readPayslipSession();
  if (!session) redirect("/payslip/expired");
  const loaded = await payslipForEmployee(createAdminClient(), session.payslipId);
  if (!loaded) redirect("/payslip/expired");
  const slip = loaded.slips[0];
  const money = (n: number) => formatMoney(n, loaded.run.currency);
  return (
    <div className="theme-public flex min-h-screen flex-col">
      <SiteHeader section="Payslip" />
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-14">
        <span aria-hidden className="mb-6 block h-1 w-12 rounded-full bg-[var(--brand-mark)]" />
        <h1 className="text-3xl font-semibold tracking-tight">Your payslip for {periodLabel(loaded.run.period)}</h1>
        <p className="mt-2 text-muted-foreground">
          {slip.snapshot.name}, {slip.snapshot.position}, {loaded.campus.name}.
        </p>
        <dl className="mt-8 divide-y divide-border rounded-2xl border border-border">
          {(
            [
              ["Gross pay", money(Number(slip.gross_minor))],
              ["Deductions", money(Number(slip.deductions_minor))],
              ["Net pay", money(Number(slip.net_minor))],
            ] as const
          ).map(([label, value], i) => (
            <div key={label} className="flex items-center justify-between px-5 py-4">
              <dt className={i === 2 ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
              <dd className={cn("tabular-nums", i === 2 ? "text-xl font-semibold" : "")}>{value}</dd>
            </div>
          ))}
        </dl>
        <a href="/payslip/pdf" className={cn(buttonVariants({ size: "parent" }), "mt-8")}>
          <Download aria-hidden /> Download the full payslip (PDF)
        </a>
        <p className="mt-4 text-sm text-muted-foreground">If something looks wrong, reply to the email that brought you here, and Human Resources will look into it.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
