import { PageTitle } from "@/components/staff/page-title";
import { NamedAdd, NamedRow } from "@/components/stores/settings-forms";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";

export const metadata = { title: "Departments" };

export default async function Page() {
  const { supabase } = await requireStaff("stores.admin");
  const rows = await listNamed(supabase, "stores_departments", { includeInactive: true });
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Departments" description="Who stock is issued and assets are assigned to. A department with history is switched off, never deleted." back={{ href: "/staff/stores/settings", label: "Settings" }} />
      <div className="space-y-2">
        <NamedAdd list="departments" placeholder="New department, for example Grounds" />
        {rows.map((r) => <NamedRow key={r.id} list="departments" id={r.id} name={r.name} isActive={r.is_active} />)}
      </div>
    </div>
  );
}
