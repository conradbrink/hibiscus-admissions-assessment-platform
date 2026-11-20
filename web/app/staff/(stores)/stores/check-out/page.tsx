import { PageTitle } from "@/components/staff/page-title";
import { CheckoutForm } from "@/components/stores/checkout-form";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements, listEmployees, listItems, listNamed } from "@/lib/stores/data";
import { schoolToday } from "@/lib/stores/server";

export const metadata = { title: "Check out equipment" };

export default async function CheckOutPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const [employees, departments, items, ack] = await Promise.all([
    listEmployees(supabase),
    listNamed(supabase, "stores_departments"),
    listItems(supabase, ["reusable"]),
    acknowledgements(supabase),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Check out equipment" description="Equipment that goes out and comes back. The employee signs for it on this device." />
      <CheckoutForm employees={employees} departments={departments} items={items} initialItemId={sp.item ?? null} today={schoolToday()} acknowledgement={ack.checkout} />
    </div>
  );
}
