import { StaffSidebar } from "@/components/staff/sidebar";
import { visibleNavGroups } from "@/components/staff/nav-items";
import { requireStaff } from "@/lib/staff/session";

/**
 * The console shell. The proxy has already refused anyone signed out or
 * without access to this path; this loads who they are for the sidebar.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const groups = visibleNavGroups(ctx.permissions);
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <StaffSidebar groups={groups} email={ctx.profile.email} />
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">{children}</main>
    </div>
  );
}
