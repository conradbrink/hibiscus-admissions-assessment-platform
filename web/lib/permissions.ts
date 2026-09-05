/**
 * What a member of staff may do, and which pages that lets them open.
 *
 * ⚠️ This module must stay free of any client-only or server-only import —
 * plain data and pure functions. Both `proxy.ts` (edge) and the staff sidebar
 * (browser) read it, and they must read the same answer.
 *
 * The permission codes here mirror `public.permissions` in the database
 * exactly, and the database is the authority: RLS policies call
 * `has_permission(code)`, and this file only decides which link to show and
 * which path to bounce. A page that is visible but whose data is refused is a
 * bug in this file; a page whose data is visible without the permission is a
 * bug in the schema, and far more serious.
 */

export const PERMISSION_CODES = [
  /** Satisfies every check. Held by the super_admin role only. */
  "admin",
  "applications.read",
  "applications.write",
  "assessments.deliver",
  "assessments.score.write",
  "assessments.author",
  "offers.read",
  "offers.approve",
  "decisions.override",
  "finance.read",
  "finance.write",
  "rules.write",
  "templates.write",
  "staff.write",
  "settings.write",
  "analytics.read",
  "data.export",
  "audit.read",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  admin: "Full administrative access",
  "applications.read": "View applicants and the pipeline",
  "applications.write": "Edit applicants, book and reschedule",
  "assessments.deliver": "Run assessment days: check in, launch, mark no-shows",
  "assessments.score.write": "Mark and amend assessment scores",
  "assessments.author": "Author questions, templates and benchmarks",
  "offers.read": "View offers and fee details",
  "offers.approve": "Approve and send offers",
  "decisions.override": "Override an admission decision, with a reason",
  "finance.read": "View payments",
  "finance.write": "Reconcile payments and issue refunds",
  "rules.write": "Change admission rules",
  "templates.write": "Edit email and offer templates",
  "staff.write": "Manage staff accounts and roles",
  "settings.write": "Change campuses, grades, intakes and workflow settings",
  "analytics.read": "View admissions analytics",
  "data.export": "Export applicant data",
  "audit.read": "Read the audit trail",
};

export type PermissionSet = ReadonlySet<string>;

export function toPermissionSet(codes: readonly string[] | null | undefined): PermissionSet {
  return new Set(codes ?? []);
}

/** `admin` satisfies everything, mirroring the database's `has_permission()`. */
export function can(permissions: PermissionSet, code: PermissionCode): boolean {
  return permissions.has("admin") || permissions.has(code);
}

/**
 * True when `pathname` is `prefix` or lives under it.
 *
 * Segment-aware on purpose: a bare `startsWith("/staff/admin")` would also
 * match `/staff/administration-notes`, and in a permission map a wrong match
 * grants access rather than denying it.
 */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Which permission each staff path needs. **Ordered, not a map**: the longest
 * matching prefix wins, so `/staff/admin/rules` resolves to `rules.write` and
 * not to whatever `/staff/admin` needs.
 */
const PATH_PERMISSIONS: ReadonlyArray<readonly [string, PermissionCode]> = [
  ["/staff/admin/dev-outbox", "admin"],
  ["/staff/admin/rules", "rules.write"],
  ["/staff/admin/templates", "templates.write"],
  ["/staff/admin/offer-templates", "templates.write"],
  ["/staff/admin/agreements", "templates.write"],
  ["/staff/admin/document-requirements", "settings.write"],
  ["/staff/admin/fees", "finance.write"],
  ["/staff/admin/staff", "staff.write"],
  ["/staff/admin/sessions", "applications.write"],
  ["/staff/admin/question-banks", "assessments.author"],
  ["/staff/admin/assessment-templates", "assessments.author"],
  ["/staff/admin/rubrics", "assessments.author"],
  ["/staff/admin/benchmarks", "assessments.author"],
  ["/staff/admin/competencies", "assessments.author"],
  ["/staff/admin", "settings.write"],
  ["/staff/analytics", "analytics.read"],
  ["/staff/payments", "finance.read"],
  ["/staff/registrations", "applications.read"],
  ["/staff/offers", "offers.read"],
  // The attempt page is for anyone who may see the applicant, not only for
  // the people who run assessment days; the longer prefix wins.
  ["/staff/assessments/attempts", "applications.read"],
  ["/staff/assessments", "assessments.deliver"],
  ["/staff/decisions", "applications.read"],
  ["/staff/applications", "applications.read"],
  ["/staff/tasks", "applications.read"],
  ["/staff", "applications.read"],
];

/** Reachable by anyone signed in, whatever they hold. */
const ALWAYS_ALLOWED = ["/staff/no-access", "/staff/account"];

export function permissionForPath(pathname: string): PermissionCode | null {
  if (ALWAYS_ALLOWED.some((p) => matchesPrefix(pathname, p))) return null;
  let best: (typeof PATH_PERMISSIONS)[number] | undefined;
  for (const entry of PATH_PERMISSIONS) {
    if (matchesPrefix(pathname, entry[0])) {
      if (!best || entry[0].length > best[0].length) best = entry;
    }
  }
  // Unmapped staff paths fail closed. A page added tomorrow with no entry
  // here is refused until somebody decides who it belongs to.
  return best?.[1] ?? "admin";
}

export function canAccessPath(permissions: PermissionSet, pathname: string): boolean {
  const needed = permissionForPath(pathname);
  return needed === null || can(permissions, needed);
}

/**
 * The first page this person can actually open, in a fixed order of
 * usefulness. Falls through to a dead-end notice rather than a redirect loop.
 */
export function homeFor(permissions: PermissionSet): string {
  const candidates = [
    "/staff",
    "/staff/assessments/today",
    "/staff/payments",
    "/staff/analytics",
    "/staff/admin/question-banks",
  ];
  for (const path of candidates) {
    if (canAccessPath(permissions, path)) return path;
  }
  return "/staff/no-access";
}
