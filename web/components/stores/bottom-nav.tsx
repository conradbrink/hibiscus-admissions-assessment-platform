"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "@/components/staff/nav-icons";
import type { NavIcon } from "@/components/staff/nav-items";
import { matchesPrefix } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export type BottomNavItem = { href: string; label: string; icon: NavIcon; exact?: boolean };

/**
 * The storekeeper's thumb bar on a phone: the four or five things done all
 * day, always one tap away, while the full menu stays behind the button at
 * the top. Hidden from a tablet up, where the rail is on screen, and on
 * paper.
 */
export function StoresBottomNav({ items }: { items: BottomNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Storeroom"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const active = item.exact ? pathname === item.href : matchesPrefix(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-15 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] leading-tight font-medium transition-colors outline-none focus-visible:bg-muted",
                  active ? "text-primary" : "text-muted-foreground active:bg-muted"
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", active && "bg-accent")}>
                  <Icon className="size-5" strokeWidth={1.9} aria-hidden />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
