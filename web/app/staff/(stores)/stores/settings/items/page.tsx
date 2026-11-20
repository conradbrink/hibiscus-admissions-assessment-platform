import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { ReactivateButton } from "@/components/stores/settings-forms";
import { requireStaff } from "@/lib/staff/session";

export const metadata = { title: "Item configuration" };

/** Items that have been switched off, and the way back on. Everything else about an item is on its own page. */
export default async function ItemConfigurationPage() {
  const { supabase } = await requireStaff("stores.admin");
  const { data } = await supabase.from("stores_items").select("id, name, qty_total, updated_at").eq("is_active", false).order("name");
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Item configuration" description="Switched-off items keep their history and cannot go out. Change an item's details, reorder level or location from its own page." back={{ href: "/staff/stores/settings", label: "Settings" }} />
      {data && data.length ? (
        <ul className="space-y-2">
          {data.map((i) => (
            <li key={i.id} className="surface flex items-center justify-between gap-3 px-4 py-3">
              <span><Link href={`/staff/stores/inventory/${i.id}`} className="font-semibold hover:underline">{i.name}</Link><span className="block text-xs text-muted-foreground">{i.qty_total} on the register</span></span>
              <ReactivateButton id={i.id} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No items are switched off.</EmptyState>
      )}
    </div>
  );
}
