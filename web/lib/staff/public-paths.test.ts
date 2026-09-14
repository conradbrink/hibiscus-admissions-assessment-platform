import { describe, expect, it } from "vitest";
import { isStaffPublicPath, STAFF_PUBLIC_PREFIXES } from "./public-paths";
import { MFA_EXEMPT_PREFIXES } from "./mfa";
import { permissionForPath } from "@/lib/permissions";

describe("what a signed-out person may open under /staff", () => {
  it("lets an invited member of staff reach the page that sets their password", () => {
    // The whole bug: the invitation email says "choose your password here",
    // and the link must land on that form, not on the sign-in page.
    expect(isStaffPublicPath("/staff/invite/abc123")).toBe(true);
    expect(isStaffPublicPath("/staff/reset-password/abc123")).toBe(true);
    expect(isStaffPublicPath("/staff/forgot-password")).toBe(true);
    expect(isStaffPublicPath("/staff/login")).toBe(true);
  });

  it("keeps everything else behind sign-in", () => {
    for (const path of ["/staff", "/staff/applications", "/staff/admin/staff", "/staff/inviteX", "/staff/loginx"]) {
      expect(isStaffPublicPath(path)).toBe(false);
    }
  });

  it("is the same list the second-factor check and the permission map use", () => {
    // Three guards, one answer. A page reachable without a session must not
    // then demand a second factor or a permission of the person it lets in.
    expect([...MFA_EXEMPT_PREFIXES]).toEqual([...STAFF_PUBLIC_PREFIXES]);
    for (const prefix of STAFF_PUBLIC_PREFIXES) {
      expect(permissionForPath(`${prefix}/token`)).toBeNull();
    }
  });
});
