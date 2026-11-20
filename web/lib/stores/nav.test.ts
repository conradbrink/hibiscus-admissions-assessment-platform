import { describe, expect, it } from "vitest";
import { canAccessPath, homeFor, permissionForPath, toPermissionSet } from "@/lib/permissions";
import { STORES_NAV_GROUPS, STORES_SETTINGS_SECTIONS, visibleStoresGroups, visibleStoresSettings } from "@/lib/stores/nav";

const keeper = toPermissionSet(["stores.read", "stores.write"]);
const storesAdmin = toPermissionSet(["stores.read", "stores.write", "stores.admin"]);
const reader = toPermissionSet(["stores.read"]);
const admissions = toPermissionSet(["applications.read", "applications.write"]);

const hrefs = (groups: ReturnType<typeof visibleStoresGroups>) => groups.flatMap((g) => g.items.map((i) => i.href));

describe("the Stores rail", () => {
  it("has the nine places the school asked for, in order", () => {
    expect(STORES_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      "Dashboard", "Inventory", "Check Out Equipment", "Check In Equipment", "Stock Issues", "Receive Stock", "Stock Movements", "Reports", "Settings",
    ]);
  });

  it("never offers a link the proxy would bounce", () => {
    for (const p of [keeper, storesAdmin, reader, admissions]) {
      for (const href of hrefs(visibleStoresGroups(p))) expect(canAccessPath(p, href)).toBe(true);
      for (const g of visibleStoresSettings(p)) for (const i of g.items) expect(canAccessPath(p, i.href)).toBe(true);
    }
  });

  it("gives the storekeeper the employee directory as their Settings, and the administrator the hub", () => {
    expect(hrefs(visibleStoresGroups(keeper))).toContain("/staff/stores/settings/employees");
    expect(hrefs(visibleStoresGroups(keeper))).not.toContain("/staff/stores/settings");
    expect(hrefs(visibleStoresGroups(storesAdmin))).toContain("/staff/stores/settings");
    expect(visibleStoresSettings(keeper).flatMap((g) => g.items.map((i) => i.href))).toEqual(["/staff/stores/settings/employees"]);
  });

  it("shows a read-only person what they may read and none of the storeroom's actions", () => {
    expect(hrefs(visibleStoresGroups(reader))).toEqual(["/staff/stores", "/staff/stores/inventory", "/staff/stores/movements", "/staff/stores/reports"]);
  });

  it("shows nothing at all to somebody outside Stores", () => {
    expect(visibleStoresGroups(admissions)).toEqual([]);
    expect(visibleStoresSettings(admissions)).toEqual([]);
  });

  it("names a permission for every settings page", () => {
    for (const g of STORES_SETTINGS_SECTIONS) for (const i of g.items) expect(permissionForPath(i.href)).not.toBe("admin");
  });
});

describe("Stores paths", () => {
  it("lets the storekeeper record stock and keeps the settings from them", () => {
    for (const path of ["/staff/stores/check-out", "/staff/stores/check-in/abc", "/staff/stores/issues", "/staff/stores/receive", "/staff/stores/inventory/new", "/staff/stores/settings/employees"]) {
      expect(canAccessPath(keeper, path)).toBe(true);
      expect(canAccessPath(reader, path)).toBe(false);
    }
    for (const path of ["/staff/stores/settings", "/staff/stores/settings/departments", "/staff/stores/settings/users"]) {
      expect(canAccessPath(keeper, path)).toBe(false);
      expect(canAccessPath(storesAdmin, path)).toBe(true);
    }
  });

  it("sends somebody who holds only Stores to Stores when they sign in", () => {
    expect(homeFor(keeper)).toBe("/staff/stores");
    expect(homeFor(reader)).toBe("/staff/stores");
  });

  it("keeps Stores closed to the admissions team", () => {
    expect(canAccessPath(admissions, "/staff/stores")).toBe(false);
    expect(canAccessPath(admissions, "/staff/stores/inventory")).toBe(false);
  });
});
