import { EventForm } from "@/components/crm/event-form";
import { PageTitle } from "@/components/staff/page-title";
import { requireStaff } from "@/lib/staff/session";

export default async function NewEventPage() {
  const { supabase } = await requireStaff("crm.write");
  const [{ data: campuses }, { data: staff }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/events", label: "Events" }} title="Add an event" description="A campus event is that campus's; leave the campus blank for a group-wide one." />
      <EventForm campuses={campuses ?? []} staff={staff ?? []} />
    </>
  );
}
