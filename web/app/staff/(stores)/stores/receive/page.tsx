import { PageTitle } from "@/components/staff/page-title";
import { ReceiveForm } from "@/components/stores/receive-form";
import { requireStaff } from "@/lib/staff/session";
import { listItems, listNamed } from "@/lib/stores/data";
import { schoolToday } from "@/lib/stores/server";

export const metadata = { title: "Receive stock" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const [items, categories, locations] = await Promise.all([listItems(supabase), listNamed(supabase, "stores_categories"), listNamed(supabase, "stores_locations")]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Receive stock" description="Record what has been bought or delivered. It goes straight onto the shelf." />
      <ReceiveForm items={items} categories={categories} locations={locations} initialItemId={sp.item ?? null} today={schoolToday()} />
    </div>
  );
}
