import { canAccessPath, can, type PermissionCode, type PermissionSet } from "@/lib/permissions";

/**
 * The HR console's navigation, as data. Each item names the permission it
 * needs and must also pass `canAccessPath`, so the rail never offers a link
 * that bounces. Icons are named here and resolved in the (client) sidebar.
 */
export type NavIcon = "dashboard" | "vacancies" | "pipeline" | "questions" | "employees" | "timesheets" | "payroll" | "leave" | "disciplinary" | "settings" | "audit";

export type NavItem = { href: string; label: string; icon: NavIcon; permission?: PermissionCode };
export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: "/staff", label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Recruitment",
    items: [
      { href: "/staff/recruitment/pipeline", label: "Pipeline", icon: "pipeline", permission: "hr.recruitment.read" },
      { href: "/staff/recruitment/vacancies", label: "Vacancies", icon: "vacancies", permission: "hr.recruitment.read" },
      { href: "/staff/recruitment/question-banks", label: "Question banks", icon: "questions", permission: "hr.questions.write" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/staff/employees", label: "Employees", icon: "employees", permission: "hr.employees.read" },
      { href: "/staff/leave", label: "Leave", icon: "leave", permission: "hr.leave.approve" },
      { href: "/staff/disciplinary", label: "Disciplinary", icon: "disciplinary", permission: "hr.disciplinary.read" },
    ],
  },
  {
    label: "Pay",
    items: [
      { href: "/staff/timesheets", label: "Timesheets", icon: "timesheets", permission: "hr.timesheets.write" },
      { href: "/staff/payroll", label: "Payroll", icon: "payroll", permission: "hr.payroll.read" },
      { href: "/staff/payroll/tax-years", label: "Tax tables", icon: "settings", permission: "hr.tax_tables.write" },
    ],
  },
];

export function visibleNavGroups(permissions: PermissionSet): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.permission || can(permissions, i.permission)) && canAccessPath(permissions, i.href)),
  })).filter((g) => g.items.length);
}

/** The rail item a path belongs to: the longest href that prefixes it. */
export function activeHref(pathname: string, groups: NavGroup[]): string | null {
  // An applicant's page belongs to the pipeline it was opened from.
  if (pathname.startsWith("/staff/recruitment/applications/")) pathname = "/staff/recruitment/pipeline";
  // The dashboard is only itself; every other page sits under /staff.
  if (pathname === "/staff") return "/staff";
  let best: string | null = null;
  for (const g of groups) {
    for (const i of g.items) {
      if (i.href === "/staff") continue;
      if (pathname === i.href || pathname.startsWith(i.href + "/")) {
        if (!best || i.href.length > best.length) best = i.href;
      }
    }
  }
  return best;
}
