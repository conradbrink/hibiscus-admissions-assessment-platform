import { PageTitle } from "@/components/staff/page-title";
import { ItemForm } from "@/components/stores/item-form";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";

export const metadata = { title: "Add item" };

export default async function NewItemPage() {
  const { supabase } = await requireStaff("stores.write");
  const [categories, locations] = await Promise.all([listNamed(supabase, "stores_categories"), listNamed(supabase, "stores_locations")]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Add an item" description="Put something new on the register. Its opening stock is recorded as its first receipt." back={{ href: "/staff/stores/inventory", label: "Inventory" }} />
      <div className="surface p-4 sm:p-6">
        <ItemForm categories={categories} locations={locations} />
      </div>
    </div>
  );
}
