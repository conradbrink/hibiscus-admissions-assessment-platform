import { AssignForm } from "@/components/stores/issue-forms";
import { IssuesHeader } from "@/components/stores/issues-tabs";
import { requireStaff } from "@/lib/staff/session";
import { listEmployees, listItems, listNamed } from "@/lib/stores/data";

export const metadata = { title: "Assign an asset" };

export default async function AssignPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("stores.write");
  const [employees, departments, items] = await Promise.all([listEmployees(supabase), listNamed(supabase, "stores_departments"), listItems(supabase, ["asset", "reusable"])]);
  return (
    <div className="mx-auto max-w-2xl">
      <IssuesHeader current="assign" description="Equipment placed with a department for good. It leaves the shelf and stays on the school's asset register." />
      <AssignForm employees={employees} departments={departments} items={items} initialItemId={sp.item ?? null} />
    </div>
  );
}
