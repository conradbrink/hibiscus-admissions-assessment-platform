"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { initials } from "@/components/staff/initials";
import { NAV_ICONS } from "@/components/staff/nav-icons";
import { activeHref, type NavGroup } from "@/components/staff/nav-items";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The left rail: the logo, the switch between the two halves of the
 * platform, one icon and word per destination with the active one tinted
 * in the brand colour, and who is signed in at the foot. On a phone it
 * folds behind a menu button.
 */
/** Which half of the platform the rail is drawing, and the way across. */
export type SidebarProduct = {
  /** "Admissions" or "CRM": the half this is, named in the switcher. */
  label: string;
  home: string;
  /**
   * The other half: where the switch link goes and what it is called. `short`
   * is what the switcher shows when the full name will not fit beside the
   * name of this half; the full name stays as the link's accessible name.
   */
  switchTo: { href: string; label: string; short?: string } | null;
};

const ADMISSIONS: SidebarProduct = { label: "Admissions", home: "/staff", switchTo: { href: "/staff/crm", label: "Hibiscus CRM", short: "CRM" } };

export function StaffSidebar({
  groups,
  name,
  email,
  product = ADMISSIONS,
  className,
}: {
  groups: NavGroup[];
  name: string;
  email: string;
  product?: SidebarProduct;
  /** Extra classes for the rail on a wide screen: the console keeps it in place while the page scrolls. */
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname, groups);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/staff/login");
    router.refresh();
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pt-1 pb-4">
      {/* The way across to the other half of the platform. First in the
          rail, above the day's work, because switching is the one thing a
          person does before anything else when they are in the wrong one.
          It reads as a switcher: the half you are in, and the other. */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-sidebar-border py-1 pr-1 pl-3 text-[12.5px]">
        <span className="truncate font-semibold text-foreground">{product.label}</span>
        {product.switchTo ? (
          <Link
            href={product.switchTo.href}
            onClick={() => setOpen(false)}
            aria-label={`Switch to ${product.switchTo.label}`}
            title={`Switch to ${product.switchTo.label}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
            {product.switchTo.short ?? product.switchTo.label}
          </Link>
        ) : null}
      </div>
      {groups.map((group, gi) => (
        <div key={gi} className={group.separated ? "border-t border-sidebar-border pt-4" : undefined}>
          {group.label ? <p className="mb-1 px-2.5 text-[11.5px] font-medium text-muted-foreground">{group.label}</p> : null}
          <ul className="space-y-px">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const isActive = active === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                      isActive
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-sidebar-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground transition-colors group-hover:text-foreground")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-4 py-3 text-xs">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">{initials(name || email)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{name || email}</p>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
            <LogOut className="size-3" aria-hidden /> Sign out
          </button>
        </span>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn("hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex print:hidden", className)}>
        <div className="px-5 pt-5 pb-4">
          <Link href={product.home} aria-label={`Hibiscus ${product.label}`} className="block w-fit">
            <Logo className="h-8 w-auto" />
          </Link>
        </div>
        {nav}
        {footer}
      </aside>
      <div className="flex h-13 items-center justify-between border-b border-sidebar-border bg-sidebar px-3 md:hidden print:hidden">
        <Link href={product.home} aria-label={`Hibiscus ${product.label}`}>
          <Logo className="h-7 w-auto" />
        </Link>
        <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 top-13 z-40 flex flex-col bg-sidebar pt-3 md:hidden print:hidden">
          {nav}
          {footer}
        </div>
      ) : null}
    </>
  );
}
