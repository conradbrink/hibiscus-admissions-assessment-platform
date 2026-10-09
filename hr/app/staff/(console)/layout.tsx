import { visibleNavGroups } from "@/components/staff/nav";
import { StaffSidebar } from "@/components/staff/sidebar";
import { requireStaff } from "@/lib/staff/session";

/**
 * The console shell: the rail on the left and the page on the right, in the
 * same raised window as the admissions console. The proxy has already
 * refused anyone signed out or without access to this path.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const groups = visibleNavGroups(ctx.permissions);
  const admissionsUrl = (process.env.NEXT_PUBLIC_ADMISSIONS_URL ?? "").replace(/\/+$/, "") || null;
  return (
    <div className="min-h-dvh md:p-4 lg:p-6">
      <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col overflow-hidden bg-card/80 backdrop-blur md:min-h-[calc(100dvh-2rem)] md:flex-row md:rounded-3xl md:border md:border-white/60 md:shadow-lift lg:min-h-[calc(100dvh-3rem)]">
        <StaffSidebar groups={groups} name={ctx.profile.full_name ?? ""} email={ctx.profile.email} admissionsUrl={admissionsUrl} />
        <main className="min-w-0 flex-1 bg-background/70 px-4 py-5 md:px-8 md:py-6">{children}</main>
      </div>
    </div>
  );
}
