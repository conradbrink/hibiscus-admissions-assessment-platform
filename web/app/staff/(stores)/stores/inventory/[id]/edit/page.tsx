import { notFound } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { ItemForm } from "@/components/stores/item-form";
import { requireStaff } from "@/lib/staff/session";
import { listNamed } from "@/lib/stores/data";
import { itemPhotoUrl } from "@/lib/stores/photo";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireStaff("stores.write");
  const [{ data: item }, categories, locations] = await Promise.all([
    supabase.from("stores_items").select("*, stores_item_photos(sha256)").eq("id", id).maybeSingle(),
    listNamed(supabase, "stores_categories", { includeInactive: true }),
    listNamed(supabase, "stores_locations", { includeInactive: true }),
  ]);
  if (!item) notFound();
  const price = item.purchase_price_minor === null ? "" : (item.purchase_price_minor / 100).toFixed(2);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title={`Edit ${item.name}`} description="What the item is, and where it is kept. Quantities change only through stock movements." back={{ href: `/staff/stores/inventory/${item.id}`, label: item.name }} />
      <div className="surface p-4 sm:p-6">
        <ItemForm
          categories={categories.filter((c) => c.is_active || c.id === item.category_id)}
          locations={locations.filter((l) => l.is_active || l.id === item.location_id)}
          initial={{
            id: item.id,
            name: item.name,
            description: item.description ?? "",
            categoryId: item.category_id,
            itemType: item.item_type,
            unit: item.unit,
            minStock: item.min_stock,
            locationId: item.location_id ?? "",
            price,
            supplier: item.supplier ?? "",
            isActive: item.is_active,
            photoUrl: itemPhotoUrl(item.id, (Array.isArray(item.stores_item_photos) ? item.stores_item_photos[0] : item.stores_item_photos)?.sha256),
          }}
        />
      </div>
    </div>
  );
}
