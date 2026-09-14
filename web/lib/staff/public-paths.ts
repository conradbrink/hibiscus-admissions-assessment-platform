/**
 * The staff pages somebody who is not signed in may open.
 *
 * One list, read by the route guard in `proxy.ts`, by the second-factor check
 * and by the permission map, because they used to disagree: the guard knew
 * about the sign-in and password pages and not the invitation page, so an
 * invited member of staff — who by definition has no session — was bounced
 * from their invitation link to the sign-in form, told to "choose a password"
 * by an email and shown a form that wanted one they did not have. Adding a
 * page here is now the whole job.
 */
export const STAFF_PUBLIC_PREFIXES = [
  "/staff/login",
  "/staff/forgot-password",
  /** `/staff/reset-password/<token>`: the link a reset email carries. */
  "/staff/reset-password",
  /** `/staff/invite/<token>`: the link an invitation carries. */
  "/staff/invite",
] as const;

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isStaffPublicPath(pathname: string): boolean {
  return STAFF_PUBLIC_PREFIXES.some((p) => matches(pathname, p));
}
