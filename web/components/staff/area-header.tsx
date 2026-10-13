import Link from "next/link";
import { cn } from "@/lib/utils";

export type AreaHeaderTab = { label: string; href: string; active: boolean; count?: number };

/**
 * The top of every page in an area of the console (Admissions, Students,
 * Insights): the area's name, its tabs, and, where the tab has more than one
 * screen, a switch between them. Then a line about what is on screen, with
 * that screen's own links beside it.
 *
 * The area is one menu item; these tabs are how somebody moves around inside
 * it, so the pages that used to be menu items of their own are one row away
 * rather than gone.
 */
export function AreaHeader({
  title,
  tabsLabel,
  tabs,
  views = [],
  description,
  actions,
  viewActions,
}: {
  title: string;
  /** What the tabs are, for a screen reader: "Stages", "Pages". */
  tabsLabel: string;
  tabs: AreaHeaderTab[];
  /** The screens of the current tab, shown when there is more than one. */
  views?: AreaHeaderTab[];
  description?: React.ReactNode;
  /** The area's own buttons, beside its name: Add applicant. */
  actions?: React.ReactNode;
  /** The screen's own links, beside its description: Previous day, Next day. */
  viewActions?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance text-foreground">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {tabs.length > 1 ? (
        <nav aria-label={tabsLabel} className="mt-4 border-b border-border">
          <ul className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((t) => (
              <li key={t.href} className="shrink-0">
                <Link
                  href={t.href}
                  aria-current={t.active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-t-sm border-b-2 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    t.active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-input hover:text-foreground"
                  )}
                >
                  {t.label}
                  {t.count !== undefined ? (
                    <span className={cn("rounded-md px-1.5 text-xs leading-5 tabular-nums", t.active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{t.count}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {views.length > 1 ? (
        <nav aria-label={`${tabs.find((t) => t.active)?.label ?? title} views`} className="mt-4">
          <ul className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {views.map((v) => (
              <li key={v.href}>
                <Link
                  href={v.href}
                  aria-current={v.active ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-1 text-[13px] whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    v.active ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {description || viewActions ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : <span />}
          {viewActions ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">{viewActions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
