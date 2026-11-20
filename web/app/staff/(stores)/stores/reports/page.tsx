import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { PageTitle } from "@/components/staff/page-title";
import { requireStaff } from "@/lib/staff/session";
import { REPORTS, REPORT_KINDS } from "@/lib/stores/reports";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireStaff("stores.read");
  return (
    <>
      <PageTitle title="Reports" description="Eight plain reports. Each can be filtered and downloaded for Excel." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/staff/stores/reports/${k}`} className="surface flex items-start gap-3 px-4 py-3.5 transition-shadow hover:shadow-lift">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><FileBarChart className="size-4.5" aria-hidden /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{REPORTS[k].title}</span><span className="block text-xs text-muted-foreground">{REPORTS[k].blurb}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
