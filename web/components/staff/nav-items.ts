import type { PermissionCode, PermissionSet } from "@/lib/permissions";
import { canAccessPath } from "@/lib/permissions";

/**
 * The staff navigation, as data. Each item names the permission it needs;
 * `visibleNavGroups` requires both that and `canAccessPath`, so the two can
 * never drift into offering a link that bounces. Icons are named, not
 * imported, because the sidebar (a client component) resolves them and the
 * layout (a server component) hands the groups across.
 *
 * Twelve destinations and one Settings hub: the day's work on the left,
 * everything the process is configured from behind one door.
 */
export type NavIcon =
  | "dashboard" | "applicants" | "assessment" | "tasks" | "decisions" | "offers"
  | "payments" | "registrations" | "export" | "students" | "analytics" | "forecast" | "settings"
  | "questions" | "templates" | "rubrics" | "benchmarks" | "competencies" | "rules"
  | "sessions" | "holidays" | "email" | "whatsapp" | "offerTemplates" | "agreements" | "documents"
  | "fees" | "promotions" | "campuses" | "grades" | "intakes" | "staff" | "workflow" | "retention" | "columns" | "outbox" | "jobs";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: PermissionCode;
  /** One line on the Settings hub saying what lives behind the link. */
  blurb?: string;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/staff", label: "Dashboard", icon: "dashboard", permission: "applications.read" },
      { href: "/staff/applications", label: "Applicants", icon: "applicants", permission: "applications.read" },
      { href: "/staff/assessments/today", label: "Assessment day", icon: "assessment", permission: "assessments.deliver" },
      { href: "/staff/tasks", label: "Tasks", icon: "tasks", permission: "applications.read" },
    ],
  },
  {
    label: "Decisions",
    items: [
      { href: "/staff/decisions", label: "Review queue", icon: "decisions", permission: "applications.read" },
      { href: "/staff/offers", label: "Offers", icon: "offers", permission: "offers.read" },
    ],
  },
  {
    label: "Enrolment",
    items: [
      { href: "/staff/payments", label: "Payments", icon: "payments", permission: "finance.read" },
      { href: "/staff/registrations", label: "Registrations", icon: "registrations", permission: "applications.read" },
      { href: "/staff/enrolment/exports", label: "Student export", icon: "export", permission: "data.export" },
    ],
  },
  {
    label: "The school",
    items: [
      { href: "/staff/students", label: "Students", icon: "students", permission: "students.read" },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/staff/analytics", label: "Analytics", icon: "analytics", permission: "analytics.read" },
      { href: "/staff/analytics/forecast", label: "Forecast", icon: "forecast", permission: "analytics.read" },
    ],
  },
  {
    label: null,
    items: [{ href: "/staff/admin", label: "Settings", icon: "settings", permission: "applications.read" }],
  },
];

/** Everything behind Settings, in the groups the hub page shows. */
export const SETTINGS_SECTIONS: NavGroup[] = [
  {
    label: "Assessments",
    items: [
      { href: "/staff/admin/question-banks", label: "Question banks", icon: "questions", permission: "assessments.author", blurb: "The questions each paper draws from" },
      { href: "/staff/admin/assessment-templates", label: "Assessment templates", icon: "templates", permission: "assessments.author", blurb: "Which paper each grade sits, section by section" },
      { href: "/staff/admin/rubrics", label: "Writing rubrics", icon: "rubrics", permission: "assessments.author", blurb: "How written answers are marked" },
      { href: "/staff/admin/benchmarks", label: "Benchmarks", icon: "benchmarks", permission: "assessments.author", blurb: "What counts as meeting the expectation" },
      { href: "/staff/admin/competencies", label: "Competencies", icon: "competencies", permission: "assessments.author", blurb: "The skills a result is reported against" },
      { href: "/staff/admin/rules", label: "Admission rules", icon: "rules", permission: "rules.write", blurb: "When a result becomes an offer, a review or a waitlist" },
    ],
  },
  {
    label: "Calendar",
    items: [
      { href: "/staff/admin/sessions", label: "Sessions", icon: "sessions", permission: "applications.write", blurb: "Assessment and visit slots at each campus" },
      { href: "/staff/admin/closures", label: "School holidays", icon: "holidays", permission: "settings.write", blurb: "Days no session is offered" },
    ],
  },
  {
    label: "Letters and messages",
    items: [
      { href: "/staff/admin/offer-templates", label: "Offer letter", icon: "offerTemplates", permission: "templates.write", blurb: "The wording of the offer a parent receives" },
      { href: "/staff/admin/templates", label: "Email templates", icon: "email", permission: "templates.write", blurb: "Every email the process sends" },
      { href: "/staff/admin/message-templates", label: "WhatsApp templates", icon: "whatsapp", permission: "templates.write", blurb: "The WhatsApp companions to those emails" },
      { href: "/staff/admin/agreements", label: "Agreements", icon: "agreements", permission: "templates.write", blurb: "The policies a parent signs at registration" },
      { href: "/staff/admin/document-requirements", label: "Document requirements", icon: "documents", permission: "settings.write", blurb: "What a parent must upload" },
    ],
  },
  {
    label: "Fees",
    items: [
      { href: "/staff/admin/fees", label: "Fees and bank details", icon: "fees", permission: "finance.write", blurb: "What an offer shows and what secures a place" },
      { href: "/staff/admin/promotions", label: "Promotions", icon: "promotions", permission: "settings.write", blurb: "Waived fees, discounts and gifts on an offer" },
    ],
  },
  {
    label: "The school",
    items: [
      { href: "/staff/admin/campuses", label: "Campuses", icon: "campuses", permission: "settings.write", blurb: "Names, addresses and phone numbers on letters" },
      { href: "/staff/admin/grades", label: "Grades", icon: "grades", permission: "settings.write", blurb: "The grades each campus offers" },
      { href: "/staff/admin/intakes", label: "Intakes", icon: "intakes", permission: "settings.write", blurb: "Terms and academic years a child can join" },
      { href: "/staff/admin/staff", label: "Staff and roles", icon: "staff", permission: "staff.write", blurb: "Who can sign in and what they may do" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/staff/admin/settings", label: "Workflow settings", icon: "workflow", permission: "settings.write", blurb: "Reminders, expiry days and the automation switches" },
      { href: "/staff/admin/retention", label: "Data retention", icon: "retention", permission: "settings.write", blurb: "When old applications are anonymised" },
      { href: "/staff/admin/export-columns", label: "Export columns", icon: "columns", permission: "settings.write", blurb: "The shape of the student export file" },
      { href: "/staff/admin/ed-admin-grades", label: "Ed-admin stage names", icon: "columns", permission: "settings.write", blurb: "What each stage is called in the school's other system" },
      { href: "/staff/admin/dev-outbox", label: "Outbox", icon: "outbox", permission: "admin", blurb: "Messages the test providers would have sent" },
      { href: "/staff/admin/jobs", label: "Job queue", icon: "jobs", permission: "admin", blurb: "Background work and anything that failed" },
    ],
  },
];

function allowed(permissions: PermissionSet, item: NavItem): boolean {
  return (item.permission === undefined || permissions.has("admin") || permissions.has(item.permission)) && canAccessPath(permissions, item.href);
}

export function visibleNavGroups(permissions: PermissionSet): NavGroup[] {
  const groups = NAV_GROUPS.map((group) => ({ label: group.label, items: group.items.filter((item) => allowed(permissions, item)) }));
  // The Settings door only shows when something is behind it for this person.
  return groups
    .map((g) => (g.items.some((i) => i.href === "/staff/admin") && visibleSettingsSections(permissions).length === 0 ? { ...g, items: [] } : g))
    .filter((g) => g.items.length > 0);
}

export function visibleSettingsSections(permissions: PermissionSet): NavGroup[] {
  return SETTINGS_SECTIONS.map((group) => ({ label: group.label, items: group.items.filter((item) => allowed(permissions, item)) })).filter((g) => g.items.length > 0);
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
