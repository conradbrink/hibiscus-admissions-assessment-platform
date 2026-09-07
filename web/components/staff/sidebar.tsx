"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { initials } from "@/components/staff/initials";
import { NAV_ICONS } from "@/components/staff/nav-icons";
import { activeHref, type NavGroup } from "@/components/staff/nav-items";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The left rail: the logo, one icon and word per destination, the active
 * one filled in the brand teal, and a quiet sign-out at the foot. On a
 * phone it folds behind a menu button.
 */
export function StaffSidebar({ groups, name, email }: { groups: NavGroup[]; name: string; email: string }) {
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
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label ? (
            <p className="mb-1 px-3 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/80 uppercase">{group.label}</p>
          ) : null}
          <ul className="space-y-1">
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
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-soft"
                        : "text-sidebar-foreground hover:bg-accent/70"
                    )}
                  >
                    <span className={cn("flex size-7 items-center justify-center rounded-lg", isActive ? "bg-white/15" : "bg-accent/60 text-primary")}>
                      <Icon className="size-4" aria-hidden />
                    </span>
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
    <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl bg-muted/70 px-3 py-2.5 text-xs">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">{initials(name || email)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{name || email}</p>
        <button type="button" onClick={signOut} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <LogOut className="size-3" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="px-5 pt-5 pb-3">
          <Link href="/staff" aria-label="Hibiscus Admissions" className="block">
            <Logo className="h-9 w-auto" />
            <span className="mt-1.5 block text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Admissions</span>
          </Link>
        </div>
        {nav}
        {footer}
      </aside>
      <div className="flex h-13 items-center justify-between border-b border-border bg-card px-3 md:hidden">
        <Link href="/staff" aria-label="Hibiscus Admissions">
          <Logo className="h-7 w-auto" />
        </Link>
        <button type="button" aria-label="Menu" onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 top-13 z-40 flex flex-col bg-sidebar md:hidden">
          {nav}
          {footer}
        </div>
      ) : null}
    </>
  );
}
