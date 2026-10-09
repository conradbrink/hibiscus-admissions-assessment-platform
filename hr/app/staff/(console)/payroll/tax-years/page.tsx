import Link from "next/link";
import { Pill } from "@/components/staff/field";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

export const metadata = { title: "Tax tables" };

const STATUS = { draft: { label: "Draft: check and publish", tone: "warning" }, published: { label: "In use", tone: "success" }, retired: { label: "Retired", tone: "muted" } } as const;

export default async function TaxYearsPage() {
  const ctx = await requireStaff("hr.tax_tables.write");
  const { data: years } = await ctx.supabase.from("hr_tax_years").select("*").order("country").order("starts_on", { ascending: false });
  return (
    <>
      <PageTitle
        title="Tax tables"
        description="Payroll uses these to work out income tax. Each new tax year arrives as a draft. Check every figure against the official SARS or BURS table, then publish it. Payroll will not run on a draft."
        back={{ href: "/staff/payroll", label: "Payroll" }}
      />
      {years?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Country</th>
                <th>Covers</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td>
                    <Link href={`/staff/payroll/tax-years/${y.id}`} className="font-semibold hover:text-primary hover:underline">
                      {y.code}
                    </Link>
                  </td>
                  <td>{y.country === "ZA" ? "South Africa" : "Botswana"}</td>
                  <td className="tabular-nums">
                    {formatDate(y.starts_on)} to {formatDate(y.ends_on)}
                  </td>
                  <td>
                    <Pill tone={STATUS[y.status].tone}>{STATUS[y.status].label}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No tax tables yet.</EmptyState>
      )}
    </>
  );
}
