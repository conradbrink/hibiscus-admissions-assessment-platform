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
    label: "Decisions",
    items: [
      { href: "/staff/decisions", label: "Review queue", permission: "applications.read" },
      { href: "/staff/offers", label: "Offers & outcomes", permission: "offers.read" },
    ],
  },
  {
    label: "Enrolment",
    items: [
      { href: "/staff/payments", label: "Payments", permission: "finance.read" },
      { href: "/staff/registrations", label: "Registrations", permission: "applications.read" },
      { href: "/staff/enrolment/exports", label: "Student export", permission: "data.export" },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/staff/analytics", label: "Analytics", permission: "analytics.read" },
      { href: "/staff/analytics/forecast", label: "Forecast", permission: "analytics.read" },
    ],
  },
  {
    label: "Assessment content",
    items: [
      { href: "/staff/admin/question-banks", label: "Question banks", permission: "assessments.author" },
      { href: "/staff/admin/assessment-templates", label: "Assessment templates", permission: "assessments.author" },
      { href: "/staff/admin/rubrics", label: "Writing rubrics", permission: "assessments.author" },
      { href: "/staff/admin/benchmarks", label: "Benchmarks", permission: "assessments.author" },
      { href: "/staff/admin/competencies", label: "Competencies", permission: "assessments.author" },
    ],
  },
  {
    label: "Set up",
    items: [
      { href: "/staff/admin/sessions", label: "Sessions", permission: "applications.write" },
      { href: "/staff/admin/templates", label: "Email templates", permission: "templates.write" },
      { href: "/staff/admin/message-templates", label: "WhatsApp templates", permission: "templates.write" },
      { href: "/staff/admin/offer-templates", label: "Offer templates", permission: "templates.write" },
      { href: "/staff/admin/fees", label: "Fees", permission: "finance.write" },
      { href: "/staff/admin/agreements", label: "Agreements", permission: "templates.write" },
      { href: "/staff/admin/document-requirements", label: "Document requirements", permission: "settings.write" },
      { href: "/staff/admin/export-columns", label: "Export columns", permission: "settings.write" },
      { href: "/staff/admin/rules", label: "Admission rules", permission: "rules.write" },
      { href: "/staff/admin/campuses", label: "Campuses", permission: "settings.write" },
      { href: "/staff/admin/grades", label: "Grades", permission: "settings.write" },
      { href: "/staff/admin/intakes", label: "Intakes", permission: "settings.write" },
      { href: "/staff/admin/settings", label: "Workflow settings", permission: "settings.write" },
      { href: "/staff/admin/staff", label: "Staff & roles", permission: "staff.write" },
      { href: "/staff/admin/dev-outbox", label: "Outbox", permission: "admin" },
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
