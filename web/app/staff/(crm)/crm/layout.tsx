import { StaffSidebar } from "@/components/staff/sidebar";
import { StaffTopbar } from "@/components/staff/topbar";
import { visibleCrmGroups } from "@/lib/crm/nav";
import { requireStaff } from "@/lib/staff/session";

/**
 * The CRM shell: the same raised window and rail as the admissions console,
 * drawn with the CRM's own destinations, a search that lands on the CRM's
 * search page, and the bell that counts this person's unread notices. The
 * proxy has already refused anyone without `crm.read`; this loads who they
 * are for the rail.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff("crm.read");
  const groups = visibleCrmGroups(ctx.permissions);
  const [{ count: openTasks }, { count: unread }] = await Promise.all([
    ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open").eq("assignee_staff_id", ctx.userId),
    ctx.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return (
    <div className="min-h-dvh md:p-4 lg:p-6">
      <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col overflow-hidden bg-card/80 backdrop-blur md:min-h-[calc(100dvh-2rem)] md:flex-row md:rounded-3xl md:border md:border-white/60 md:shadow-lift lg:min-h-[calc(100dvh-3rem)]">
        <StaffSidebar
          groups={groups}
          name={ctx.profile.full_name ?? ""}
          email={ctx.profile.email}
          product={{ label: "CRM", home: "/staff/crm", switchTo: { href: "/staff", label: "Hibiscus Admissions" } }}
        />
        <main className="min-w-0 flex-1 bg-background/70 px-4 py-5 md:px-8 md:py-6">
          <StaffTopbar
            name={ctx.profile.full_name ?? ""}
            email={ctx.profile.email}
            openTasks={openTasks ?? 0}
            search={{ action: "/staff/crm/search", placeholder: "Find a family, parent, child or number" }}
            tasksHref="/staff/crm/tasks?filter=mine"
            notifications={{ unread: unread ?? 0, href: "/staff/crm/notifications" }}
          />
          {children}
        </main>
      </div>
    </div>
  );
}
