import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { initials } from "@/components/staff/initials";
import { formatDate } from "@/lib/format-date";

/**
 * The strip above every page: a greeting with the date, a search that
 * lands on the applicants list, the bell with the number of open tasks
 * assigned to this person, and who is signed in.
 */
export function StaffTopbar({ name, email, openTasks }: { name: string; email: string; openTasks: number }) {
  const first = (name || email).split(/[\s@]/)[0];
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-muted-foreground">Welcome back, <span className="font-medium text-foreground">{first}</span> 👋</p>
        <p className="text-xs text-muted-foreground">{formatDate(new Date())}</p>
      </div>
      <div className="flex items-center gap-2">
        <form action="/staff/applications" method="get" role="search" className="relative hidden sm:block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            type="search"
            placeholder="Find an applicant"
            aria-label="Find an applicant"
            className="h-9 w-56 rounded-full border border-border/70 bg-card pr-3 pl-9 text-sm shadow-soft outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </form>
        <Link href="/staff/tasks?mine=1" aria-label={`${openTasks} open tasks assigned to you`} className="relative flex size-9 items-center justify-center rounded-full border border-border/70 bg-card shadow-soft hover:bg-muted">
          <Bell className="size-4 text-muted-foreground" aria-hidden />
          {openTasks > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{openTasks}</span>
          ) : null}
        </Link>
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card py-1 pr-3 pl-1 shadow-soft">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials(name || email)}</span>
          <span className="hidden text-sm font-medium sm:inline">{name || email}</span>
        </div>
      </div>
    </header>
  );
}
