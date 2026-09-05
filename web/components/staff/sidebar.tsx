"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { activeHref, type NavGroup } from "@/components/staff/nav-items";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function StaffSidebar({ groups, email }: { groups: NavGroup[]; email: string }) {
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
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label ? (
            <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-sidebar-foreground/60 uppercase">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block rounded-lg px-2 py-1.5 text-sm",
                    active === item.href
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-sidebar-border px-3 py-3 text-xs">
      <p className="truncate text-sidebar-foreground/80" title={email}>
        {email}
      </p>
      <button
        type="button"
        onClick={signOut}
        className="mt-1 inline-flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground"
      >
        <LogOut className="size-3.5" aria-hidden /> Sign out
      </button>
    </div>
  );

  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="px-4 py-4">
          <Link href="/staff" className="text-base font-bold text-primary">
            Hibiscus Admissions
          </Link>
        </div>
        {nav}
        {footer}
      </aside>
      <div className="flex h-12 items-center justify-between border-b border-border bg-card px-3 md:hidden">
        <Link href="/staff" className="text-sm font-bold text-primary">
          Hibiscus Admissions
        </Link>
        <button type="button" aria-label="Menu" onClick={() => setOpen((o) => !o)} className="rounded-md p-1.5">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 top-12 z-40 flex flex-col bg-sidebar md:hidden">
          {nav}
          {footer}
        </div>
      ) : null}
    </>
  );
}
