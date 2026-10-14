import { StaffSidebar } from "@/components/staff/sidebar";
import { StaffTopbar } from "@/components/staff/topbar";
import { visibleNavGroups } from "@/components/staff/nav-items";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";

/**
 * The console shell: the rail on the left, full height and still while the
 * page scrolls, and the greeting strip and the page on a flat light grey to
 * its right. `staff-console` tightens the corners for a working tool (see
 * globals.css). The proxy has already refused anyone signed out or without
 * access to this path; this loads who they are for the rail and the bell.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const groups = visibleNavGroups(ctx.permissions);
  const { count } = await ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open").eq("assignee_staff_id", ctx.userId);
  return (
    <div className="staff-console staff-shell flex min-h-dvh flex-col bg-background md:flex-row print:block print:min-h-0 print:bg-white">
      <StaffSidebar groups={groups} name={ctx.profile.full_name ?? ""} email={ctx.profile.email} className="md:sticky md:top-0 md:h-dvh" />
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7 lg:px-10 print:p-0">
        <div className="mx-auto w-full max-w-6xl print:max-w-none">
          <StaffTopbar
            name={ctx.profile.full_name ?? ""}
            email={ctx.profile.email}
            openTasks={count ?? 0}
            heading={{ path: "/staff", title: "Dashboard" }}
            pdf={can(ctx.permissions, "pages.export_pdf")}
          />
          {children}
        </div>
      </main>
    </div>
  );
}
