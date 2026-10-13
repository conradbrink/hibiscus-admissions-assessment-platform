"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The left of the top strip, the one part of it that depends on the page:
 * `heading` on `path`, the greeting everywhere else.
 *
 * Chosen here, from the address, because the strip belongs to the layout,
 * and a layout is not drawn again when somebody moves between its pages. A
 * choice made on the server would leave "Dashboard" over the applicants
 * list after the first click away.
 */
export function TopbarLead({ path, heading, children }: { path: string; heading: ReactNode; children: ReactNode }) {
  return usePathname() === path ? heading : children;
}
