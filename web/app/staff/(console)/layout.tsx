import { StaffSidebar } from "@/components/staff/sidebar";
import { StaffTopbar } from "@/components/staff/topbar";
import { visibleNavGroups } from "@/components/staff/nav-items";
import { requireStaff } from "@/lib/staff/session";

/**
 * The console shell: one raised window on the soft wash, the rail on the
 * left, the greeting strip and the page on the right. The proxy has
 * already refused anyone signed out or without access to this path; this
 * loads who they are for the rail and the bell.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const groups = visibleNavGroups(ctx.permissions, { orientationDone: ctx.profile.orientation_completed_at !== null });
  const { count } = await ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open").eq("assignee_staff_id", ctx.userId);
  return (
    <div className="min-h-dvh md:p-4 lg:p-6">
      <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col overflow-hidden bg-card/80 backdrop-blur md:min-h-[calc(100dvh-2rem)] md:flex-row md:rounded-3xl md:border md:border-white/60 md:shadow-lift lg:min-h-[calc(100dvh-3rem)]">
        <StaffSidebar groups={groups} name={ctx.profile.full_name ?? ""} email={ctx.profile.email} />
        <main className="min-w-0 flex-1 bg-background/70 px-4 py-5 md:px-8 md:py-6">
          <StaffTopbar name={ctx.profile.full_name ?? ""} email={ctx.profile.email} openTasks={count ?? 0} />
          {children}
        </main>
      </div>
    </div>
  );
}
