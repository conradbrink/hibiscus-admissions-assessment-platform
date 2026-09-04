import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { visibleNavGroups } from "@/components/staff/nav-items";
import { requireStaff } from "@/lib/staff/session";

export default async function AdminIndexPage() {
  const { permissions } = await requireStaff();
  const setup = visibleNavGroups(permissions).find((g) => g.label === "Set up");
  return (
    <>
      <PageTitle title="Set up" description="Everything the admissions process reads its configuration from." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(setup?.items ?? []).map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="block rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-muted">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
