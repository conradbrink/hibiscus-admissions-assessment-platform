import type { NavGroup, NavItem } from "@/components/staff/nav-items";
import { can, canAccessPath, type PermissionSet } from "@/lib/permissions";

/**
 * Hibiscus Stores' rail, as data, in the shape the admissions and CRM rails
 * use so one sidebar draws all three. Nine places, in the order the school
 * asked for them, and nothing else.
 *
 * Each item names the permission it needs and `visibleStoresGroups` also
 * asks `canAccessPath`, so the rail can never offer a link the proxy would
 * bounce. Settings is an area: an administrator opens the hub, a storekeeper
 * the one page of it that is theirs, the employee directory.
 */
export const STORES_HOME = "/staff/stores";

export const STORES_NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/staff/stores", label: "Dashboard", icon: "dashboard", permission: "stores.read", exact: true },
      { href: "/staff/stores/inventory", label: "Inventory", icon: "inventory", permission: "stores.read" },
    ],
  },
  {
    label: "Storeroom",
    items: [
      { href: "/staff/stores/check-out", label: "Check Out Equipment", icon: "checkOut", permission: "stores.write" },
      { href: "/staff/stores/check-in", label: "Check In Equipment", icon: "checkIn", permission: "stores.write" },
      { href: "/staff/stores/issues", label: "Stock Issues", icon: "stockIssues", permission: "stores.write" },
      { href: "/staff/stores/receive", label: "Receive Stock", icon: "receive", permission: "stores.write" },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/staff/stores/movements", label: "Stock Movements", icon: "movements", permission: "stores.read", match: ["/staff/stores/transactions"] },
      { href: "/staff/stores/reports", label: "Reports", icon: "reports", permission: "stores.read" },
    ],
  },
  {
    label: null,
    separated: true,
    items: [
      {
        href: "/staff/stores/settings",
        label: "Settings",
        icon: "settings",
        entries: [
          { href: "/staff/stores/settings", permission: "stores.admin" },
          { href: "/staff/stores/settings/employees", permission: "stores.write" },
        ],
        match: ["/staff/stores/settings"],
      },
    ],
  },
];

/** Everything behind Stores → Settings, in the groups the hub shows. */
export const STORES_SETTINGS_SECTIONS: NavGroup[] = [
  {
    label: "People",
    items: [
      { href: "/staff/stores/settings/employees", label: "Employees", icon: "employees", permission: "stores.write", blurb: "The people who collect stock. They never sign in." },
      { href: "/staff/stores/settings/departments", label: "Departments", icon: "departments", permission: "stores.admin", blurb: "Who stock is issued and assigned to" },
      { href: "/staff/stores/settings/users", label: "Users", icon: "staff", permission: "stores.admin", blurb: "Who may sign in to Stores, and as what" },
    ],
  },
  {
    label: "The register",
    items: [
      { href: "/staff/stores/settings/categories", label: "Categories", icon: "categories", permission: "stores.admin", blurb: "How items are grouped: Marketing, Sports Equipment…" },
      { href: "/staff/stores/settings/locations", label: "Storage locations", icon: "locations", permission: "stores.admin", blurb: "Where stock is kept" },
      { href: "/staff/stores/settings/items", label: "Item configuration", icon: "inventory", permission: "stores.admin", blurb: "Switched-off items, and switching them back on" },
    ],
  },
];

function allowed(permissions: PermissionSet, item: NavItem): boolean {
  return (item.permission === undefined || can(permissions, item.permission)) && canAccessPath(permissions, item.href);
}

export function visibleStoresGroups(permissions: PermissionSet): NavGroup[] {
  return STORES_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.flatMap((item) => {
      if (item.entries) {
        const href = item.entries.find((e) => can(permissions, e.permission) && canAccessPath(permissions, e.href))?.href;
        return href ? [{ ...item, href }] : [];
      }
      return allowed(permissions, item) ? [item] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

export function visibleStoresSettings(permissions: PermissionSet): NavGroup[] {
  return STORES_SETTINGS_SECTIONS.map((g) => ({ label: g.label, items: g.items.filter((i) => allowed(permissions, i)) })).filter((g) => g.items.length > 0);
}
