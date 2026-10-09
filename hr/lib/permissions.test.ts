import { describe, expect, it } from "vitest";
import { can, canAccessPath, permissionForPath, toPermissionSet } from "@/lib/permissions";

describe("permissions", () => {
  it("lets admin do everything except pay", () => {
    const admin = toPermissionSet(["admin"]);
    expect(can(admin, "hr.recruitment.write")).toBe(true);
    expect(can(admin, "hr.compensation.read")).toBe(false);
    expect(can(admin, "hr.payroll.approve")).toBe(false);
  });

  it("gives pay to the people who hold it", () => {
    const payroll = toPermissionSet(["hr.payroll.read", "hr.compensation.read"]);
    expect(can(payroll, "hr.payroll.read")).toBe(true);
  });

  it("uses the longest matching prefix", () => {
    expect(permissionForPath("/staff/recruitment/question-banks")).toBe("hr.questions.write");
    expect(permissionForPath("/staff/recruitment/pipeline")).toBe("hr.recruitment.read");
  });

  it("fails closed for a path nobody has mapped", () => {
    expect(permissionForPath("/staff/something-new")).toBe("admin");
  });

  it("keeps the HR console from anyone without an HR role", () => {
    const admissionsOnly = toPermissionSet(["applications.read"]);
    expect(canAccessPath(admissionsOnly, "/staff")).toBe(false);
    expect(canAccessPath(admissionsOnly, "/staff/no-access")).toBe(true);
    expect(canAccessPath(toPermissionSet(["hr.recruitment.read"]), "/staff")).toBe(true);
  });
});
