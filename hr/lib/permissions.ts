import { STAFF_PUBLIC_PREFIXES } from "@/lib/staff/public-paths";

/**
 * What a member of staff may do in the HR app, and which pages that opens.
 *
 * Plain data and pure functions: `proxy.ts` and the sidebar both read it and
 * must get the same answer. The codes mirror `public.permissions` (seeded in
 * `20261012090000_hr_foundations.sql`), and the database is the authority: a
 * page shown but whose data is refused is a bug here; data shown without the
 * permission is a bug in the schema.
 */

export const HR_PERMISSION_CODES = [
  "admin",
  "hr.recruitment.read",
  "hr.recruitment.write",
  "hr.recruitment.hire",
  "hr.recruitment.compliance.read",
  "hr.questions.write",
  "hr.employees.read",
  "hr.employees.write",
  "hr.employees.sensitive.read",
  "hr.compensation.read",
  "hr.compensation.write",
  "hr.timesheets.write",
  "hr.payroll.read",
  "hr.payroll.prepare",
  "hr.payroll.approve",
  "hr.leave.approve",
  "hr.disciplinary.read",
  "hr.disciplinary.write",
  "hr.templates.write",
  "hr.settings.write",
  "hr.tax_tables.write",
  "hr.audit.read",
  "hr.export",
] as const;

export type PermissionCode = (typeof HR_PERMISSION_CODES)[number];

/**
 * Pay is the exception to "admin satisfies everything". The database checks
 * these with `hr_has_strict()`, which ignores `admin`, so the admissions super
 * administrator does not read every salary. This list makes the screens agree.
 */
export const STRICT_CODES: ReadonlySet<PermissionCode> = new Set([
  "hr.compensation.read",
  "hr.compensation.write",
  "hr.payroll.read",
  "hr.payroll.prepare",
  "hr.payroll.approve",
]);

export type PermissionSet = ReadonlySet<string>;

export function toPermissionSet(codes: readonly string[] | null | undefined): PermissionSet {
  return new Set(codes ?? []);
}

export function can(permissions: PermissionSet, code: PermissionCode): boolean {
  if (permissions.has(code)) return true;
  return !STRICT_CODES.has(code) && permissions.has("admin");
}

/** Whether this person holds any HR permission at all, the gate to the app. */
export function isHrStaff(permissions: PermissionSet): boolean {
  if (permissions.has("admin")) return true;
  for (const p of permissions) if (p.startsWith("hr.")) return true;
  return false;
}

export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Which permission each staff path needs. The longest matching prefix wins.
 * Unmapped paths fail closed to `admin`.
 */
const PATH_PERMISSIONS: ReadonlyArray<readonly [string, PermissionCode]> = [
  ["/staff/recruitment/question-banks", "hr.questions.write"],
  ["/staff/documents", "hr.recruitment.read"],
  ["/staff/recruitment", "hr.recruitment.read"],
  ["/staff/employees", "hr.employees.read"],
  ["/staff/timesheets", "hr.timesheets.write"],
  ["/staff/payroll/tax-years", "hr.tax_tables.write"],
  ["/staff/payroll", "hr.payroll.read"],
  ["/staff/leave", "hr.leave.approve"],
  ["/staff/disciplinary", "hr.disciplinary.read"],
  ["/staff/settings/templates", "hr.templates.write"],
  ["/staff/settings", "hr.settings.write"],
  ["/staff/audit", "hr.audit.read"],
];

const ALWAYS_ALLOWED = ["/staff/no-access", ...STAFF_PUBLIC_PREFIXES];

export function permissionForPath(pathname: string): PermissionCode | null | "any_hr" {
  if (ALWAYS_ALLOWED.some((p) => matchesPrefix(pathname, p))) return null;
  // The dashboard and the security page are for anyone in HR; what each
  // tile shows is decided by its own permission.
  if (pathname === "/staff" || matchesPrefix(pathname, "/staff/security") || matchesPrefix(pathname, "/staff/verify")) {
    return "any_hr";
  }
  let best: (typeof PATH_PERMISSIONS)[number] | undefined;
  for (const entry of PATH_PERMISSIONS) {
    if (matchesPrefix(pathname, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1] ?? "admin";
}

export function canAccessPath(permissions: PermissionSet, pathname: string): boolean {
  const needed = permissionForPath(pathname);
  if (needed === null) return true;
  if (needed === "any_hr") return isHrStaff(permissions);
  return can(permissions, needed);
}

export function homeFor(permissions: PermissionSet): string {
  return isHrStaff(permissions) ? "/staff" : "/staff/no-access";
}
