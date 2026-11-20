import { IssueForm } from "@/components/stores/issue-forms";
import { IssuesHeader } from "@/components/stores/issues-tabs";
import { requireStaff } from "@/lib/staff/session";
import { listEmployees, listItems, listNamed } from "@/lib/stores/data";

export const metadata = { title: "Issue consumables" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const [employees, departments, items] = await Promise.all([listEmployees(supabase), listNamed(supabase, "stores_departments"), listItems(supabase, ["consumable"])]);
  return (
    <div className="mx-auto max-w-2xl">
      <IssuesHeader current="issue" description="Cleaning materials, stationery and other things that are used up. Deducted from stock; nothing comes back." />
      <IssueForm employees={employees} departments={departments} items={items} initialItemId={sp.item ?? null} />
    </div>
  );
}
