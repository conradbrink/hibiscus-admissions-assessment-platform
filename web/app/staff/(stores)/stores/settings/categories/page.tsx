import { PageTitle } from "@/components/staff/page-title";
import { NamedAdd, NamedRow } from "@/components/stores/settings-forms";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";

export const metadata = { title: "Categories" };

export default async function Page() {
  const { supabase } = await requireStaff("stores.admin");
  const rows = await listNamed(supabase, "stores_categories", { includeInactive: true });
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Categories" description="How items are grouped on the register and in reports." back={{ href: "/staff/stores/settings", label: "Settings" }} />
      <div className="space-y-2">
        <NamedAdd list="categories" placeholder="New category" />
        {rows.map((r) => <NamedRow key={r.id} list="categories" id={r.id} name={r.name} isActive={r.is_active} />)}
      </div>
    </div>
  );
}
