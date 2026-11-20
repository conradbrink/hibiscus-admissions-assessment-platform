import { PageTitle } from "@/components/staff/page-title";
import { NamedAdd, NamedRow } from "@/components/stores/settings-forms";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";

export const metadata = { title: "Storage locations" };

export default async function Page() {
  const { supabase } = await requireStaff("stores.admin");
  const rows = await listNamed(supabase, "stores_locations", { includeInactive: true });
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Storage locations" description="Where stock is kept. One storeroom today; add a place when it holds stock of its own." back={{ href: "/staff/stores/settings", label: "Settings" }} />
      <div className="space-y-2">
        <NamedAdd list="locations" placeholder="New location, for example Sports Store" />
        {rows.map((r) => <NamedRow key={r.id} list="locations" id={r.id} name={r.name} isActive={r.is_active} />)}
      </div>
    </div>
  );
}
