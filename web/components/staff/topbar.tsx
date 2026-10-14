import Link from "next/link";
import { Bell, Search, SquareCheck } from "lucide-react";
import { initials } from "@/components/staff/initials";
import { PagePdfButton } from "@/components/staff/page-pdf-button";
import { TopbarLead } from "@/components/staff/topbar-lead";
import { formatDate, formatWeekdayDate } from "@/lib/format-date";

/** A square, quietly bordered icon link: the bell and the tasks. */
const iconLink =
  "relative flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** The count on an icon link. */
const countBadge =
  "absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background";

/**
 * The strip above every page: a greeting with the date, a search that
 * lands on the applicants list, Download PDF for whoever may, the bell with
 * the number of open tasks assigned to this person, and who is signed in.
 * Only the dashboard's title and date are printed: a page saved as a PDF
 * starts with the page, not with the greeting or the buttons.
 */
export function StaffTopbar({
  name,
  email,
  openTasks,
  search = { action: "/staff/applications", placeholder: "Find an applicant" },
  tasksHref = "/staff/tasks?mine=1",
  notifications,
  heading,
  pdf = false,
}: {
  name: string;
  email: string;
  openTasks: number;
  /** Where the search box lands; the CRM's searches everything. */
  search?: { action: string; placeholder: string };
  tasksHref?: string;
  /** The CRM's bell: unread notices and where they are read. */
  notifications?: { unread: number; href: string };
  /**
   * A page whose title stands in the strip in place of the greeting: the
   * dashboard, where the first thing to read is what the page is and what
   * day it is, not who is signed in (their name is on the right already).
   */
  heading?: { path: string; title: string };
  /** Whether to offer Download PDF: `pages.export_pdf`. */
  pdf?: boolean;
}) {
  const first = (name || email).split(/[\s@]/)[0];
  const today = new Date();
  const greeting = (
    <div className="print:hidden">
      <p className="text-sm text-muted-foreground">Welcome back, <span className="font-medium text-foreground">{first}</span> 👋</p>
      <p className="text-xs text-muted-foreground">{formatDate(today)}</p>
    </div>
  );
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      {heading ? (
        <TopbarLead
          path={heading.path}
          heading={
            <div>
              <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance text-foreground">{heading.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{formatWeekdayDate(today)}</p>
            </div>
          }
        >
          {greeting}
        </TopbarLead>
      ) : (
        greeting
      )}
      <div className="flex items-center gap-2 print:hidden">
        <form action={search.action} method="get" role="search" className="relative hidden sm:block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <input
            name="q"
            type="search"
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className="h-9 w-60 rounded-lg border border-border bg-card pr-3 pl-9 text-sm text-foreground transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15"
          />
        </form>
        {pdf ? <PagePdfButton className={iconLink} /> : null}
        {notifications ? (
          <Link href={notifications.href} aria-label={`${notifications.unread} unread notifications`} className={iconLink}>
            <Bell className="size-4" strokeWidth={1.75} aria-hidden />
            {notifications.unread > 0 ? <span className={countBadge}>{notifications.unread}</span> : null}
          </Link>
        ) : null}
        <Link href={tasksHref} aria-label={`${openTasks} open tasks assigned to you`} className={iconLink}>
          <SquareCheck className="size-4" strokeWidth={1.75} aria-hidden />
          {openTasks > 0 ? <span className={countBadge}>{openTasks}</span> : null}
        </Link>
        <div className="ml-1 flex items-center gap-2 pl-1">
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">{initials(name || email)}</span>
          <span className="hidden text-[13px] font-medium text-foreground sm:inline">{name || email}</span>
        </div>
      </div>
    </header>
  );
}
