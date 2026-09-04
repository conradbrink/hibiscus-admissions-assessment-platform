import type { PermissionCode, PermissionSet } from "@/lib/permissions";
import { canAccessPath } from "@/lib/permissions";

/**
 * The staff navigation, as data. Each item names the permission it needs;
 * `visibleNavGroups` requires both that and `canAccessPath`, so the two can
 * never drift into offering a link that bounces.
 */
export type NavItem = {
  href: string;
  label: string;
  permission?: PermissionCode;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/staff", label: "Dashboard", permission: "applications.read" },
      { href: "/staff/applications", label: "Applicants", permission: "applications.read" },
      { href: "/staff/assessments/today", label: "Assessment day", permission: "assessments.deliver" },
      { href: "/staff/tasks", label: "Tasks", permission: "applications.read" },
    ],
  },
  {
    label: "Insight",
    items: [{ href: "/staff/analytics", label: "Analytics", permission: "analytics.read" }],
  },
  {
    label: "Set up",
    items: [
      { href: "/staff/admin/sessions", label: "Sessions", permission: "applications.write" },
      { href: "/staff/admin/templates", label: "Email templates", permission: "templates.write" },
      { href: "/staff/admin/campuses", label: "Campuses", permission: "settings.write" },
      { href: "/staff/admin/grades", label: "Grades", permission: "settings.write" },
      { href: "/staff/admin/intakes", label: "Intakes", permission: "settings.write" },
      { href: "/staff/admin/settings", label: "Workflow settings", permission: "settings.write" },
      { href: "/staff/admin/staff", label: "Staff & roles", permission: "staff.write" },
      { href: "/staff/admin/dev-outbox", label: "Email outbox", permission: "admin" },
      { href: "/staff/admin/jobs", label: "Job queue", permission: "admin" },
    ],
  },
];

export function visibleNavGroups(permissions: PermissionSet): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (item) =>
        (item.permission === undefined || permissions.has("admin") || permissions.has(item.permission)) &&
        canAccessPath(permissions, item.href)
    ),
  })).filter((g) => g.items.length > 0);
}

/** Longest-prefix match so /staff/applications/123 lights up "Applicants", not "Dashboard". */
export function activeHref(pathname: string, groups: NavGroup[]): string | null {
  let best: string | null = null;
  for (const g of groups) {
    for (const item of g.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.length) best = item.href;
      }
    }
  }
  return best;
}
