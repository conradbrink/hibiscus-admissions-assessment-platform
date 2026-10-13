import type { PermissionCode, PermissionSet } from "@/lib/permissions";
import { can, canAccessPath } from "@/lib/permissions";
import { ADMISSIONS_ENTRIES, ADMISSIONS_PATHS } from "@/lib/workflow/stages";

/**
 * The staff navigation, as data. Each item names the permission it needs;
 * `visibleNavGroups` requires both that and `canAccessPath`, so the two can
 * never drift into offering a link that bounces. Icons are named, not
 * imported, because the sidebar (a client component) resolves them and the
 * layout (a server component) hands the groups across.
 *
 * Five places and one Settings hub. Admissions, Students and Insights are
 * areas: one menu item each for several pages, which their own tabs move
 * between (the stage bar in `lib/workflow/stages.ts`, and `STUDENT_TABS` and
 * `INSIGHT_TABS` below). An area opens on the first of its pages the person
 * may see, and stays lit on all of them.
 */
export type NavIcon =
  | "dashboard" | "applicants" | "assessment" | "tasks" | "decisions" | "offers"
  | "payments" | "registrations" | "export" | "students" | "onboarding" | "reenrolment" | "analytics" | "forecast" | "settings"
  | "questions" | "templates" | "rubrics" | "benchmarks" | "competencies" | "rules"
  | "sessions" | "holidays" | "email" | "whatsapp" | "offerTemplates" | "agreements" | "documents"
  | "fees" | "promotions" | "campuses" | "grades" | "intakes" | "staff" | "workflow" | "retention" | "columns" | "outbox" | "jobs"
  | "orientation"
  // The CRM's rail and settings hub.
  | "families" | "contacts" | "opportunities" | "events" | "inbox" | "campaigns" | "segments" | "automations"
  | "reports" | "lifecycle" | "tags" | "leadSources" | "approvals" | "import" | "crm";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: PermissionCode;
  /** One line on the Settings hub saying what lives behind the link. */
  blurb?: string;
  /**
   * An area's pages, in the order to try them: the item opens on the first
   * the person may see and is shown only if there is one. `href` is then
   * just the default.
   */
  entries?: ReadonlyArray<{ href: string; permission: PermissionCode }>;
  /** Further paths that light the item up: the other pages of its area. */
  match?: readonly string[];
  /** Lit only on its own address, not on everything under it: the dashboard, at the root of the console. */
  exact?: boolean;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
  /** Drawn below a rule, apart from the day's work: Settings. */
  separated?: boolean;
};

/** A tab of an area: one of the pages its menu item stands for. */
export type AreaTab = { href: string; label: string; permission: PermissionCode };

export const STUDENT_TABS: readonly AreaTab[] = [
  { href: "/staff/students", label: "All students", permission: "students.read" },
  { href: "/staff/onboarding", label: "Onboarding", permission: "students.read" },
  { href: "/staff/reenrolment", label: "Re-enrolment", permission: "reenrolment.write" },
];

export const INSIGHT_TABS: readonly AreaTab[] = [
  { href: "/staff/analytics", label: "Analytics", permission: "analytics.read" },
  { href: "/staff/analytics/forecast", label: "Forecast", permission: "analytics.read" },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/staff", label: "Dashboard", icon: "dashboard", permission: "applications.read", exact: true },
      { href: "/staff/applications", label: "Admissions", icon: "applicants", entries: ADMISSIONS_ENTRIES, match: ADMISSIONS_PATHS },
      { href: "/staff/students", label: "Students", icon: "students", entries: STUDENT_TABS, match: STUDENT_TABS.map((t) => t.href) },
      { href: "/staff/tasks", label: "Tasks", icon: "tasks", permission: "applications.read" },
      { href: "/staff/analytics", label: "Insights", icon: "analytics", entries: INSIGHT_TABS, match: ["/staff/analytics"] },
    ],
  },
  {
    label: null,
    separated: true,
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
      { href: "/staff/admin/onboarding-steps", label: "Onboarding checklist", icon: "onboarding", permission: "settings.write", blurb: "What a newly enrolled family is asked for" },
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

/** An area's first page this person may open, or null when they may open none of them. */
function areaHref(permissions: PermissionSet, item: NavItem): string | null {
  const entry = (item.entries ?? []).find((e) => can(permissions, e.permission) && canAccessPath(permissions, e.href.split("?")[0]));
  return entry?.href ?? null;
}

export function visibleNavGroups(permissions: PermissionSet): NavGroup[] {
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.flatMap((item) => {
      if (item.entries) {
        const href = areaHref(permissions, item);
        return href ? [{ ...item, href }] : [];
      }
      return allowed(permissions, item) ? [item] : [];
    }),
  }));
  // The Settings door only shows when something is behind it for this person.
  return groups
    .map((g) => (g.items.some((i) => i.href === "/staff/admin") && visibleSettingsSections(permissions).length === 0 ? { ...g, items: [] } : g))
    .filter((g) => g.items.length > 0);
}

/** The tabs of an area this person may open, with the one on screen marked. */
export function visibleAreaTabs(permissions: PermissionSet, tabs: readonly AreaTab[], current: string): Array<AreaTab & { active: boolean }> {
  return tabs.filter((t) => can(permissions, t.permission) && canAccessPath(permissions, t.href)).map((t) => ({ ...t, active: t.href === current }));
}

export function visibleSettingsSections(permissions: PermissionSet): NavGroup[] {
  return SETTINGS_SECTIONS.map((group) => ({ label: group.label, items: group.items.filter((item) => allowed(permissions, item)) })).filter((g) => g.items.length > 0);
}

/**
 * The item to light up: the one whose own address or area path is the longest
 * match, so /staff/applications/123 lights "Admissions", not "Dashboard", and
 * /staff/analytics/forecast lights "Insights".
 */
export function activeHref(pathname: string, groups: NavGroup[]): string | null {
  let best: { href: string; length: number } | null = null;
  for (const g of groups) {
    for (const item of g.items) {
      const own = item.href.split("?")[0];
      const paths = item.exact ? [] : [own, ...(item.match ?? [])];
      if (item.exact && pathname === own && (!best || own.length > best.length)) best = { href: item.href, length: own.length };
      for (const path of paths) {
        if ((pathname === path || pathname.startsWith(path + "/")) && (!best || path.length > best.length)) best = { href: item.href, length: path.length };
      }
    }
  }
  return best?.href ?? null;
}
