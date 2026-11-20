import { can, type PermissionSet } from "@/lib/permissions";

/**
 * The products on the one staff sign-in, and the way between them.
 *
 * Plain data in a plain module, not in the sidebar: the sidebar is a client
 * component, and an object exported from a `"use client"` file reaches a
 * server component as a client reference rather than as the object, so a
 * layout spreading it would spread nothing.
 */
export type ProductLink = { href: string; label: string; short?: string };

/** Which product the rail is drawing, and the ways across to the others. */
export type SidebarProduct = {
  /** "Admissions", "CRM" or "Stores": the product this is, named in the switcher. */
  label: string;
  home: string;
  /**
   * The other products this person may open, in the order they are offered.
   * `short` is what the switcher shows when the full name will not fit; the
   * full name stays as the link's accessible name.
   */
  switchTo: ProductLink[];
};

export const ADMISSIONS_LINK: ProductLink = { href: "/staff", label: "Hibiscus Admissions", short: "Admissions" };
export const CRM_LINK: ProductLink = { href: "/staff/crm", label: "Hibiscus CRM", short: "CRM" };
export const STORES_LINK: ProductLink = { href: "/staff/stores", label: "Hibiscus Stores", short: "Stores" };

/**
 * The products this person may open other than `current`. Each is offered
 * only to someone who can open its first page, so the switcher never offers
 * a door the proxy would bounce: a storekeeper sees no way into Admissions.
 */
export function otherProducts(permissions: PermissionSet, current: "admissions" | "crm" | "stores"): ProductLink[] {
  const all: Array<[typeof current, ProductLink, boolean]> = [
    ["admissions", ADMISSIONS_LINK, can(permissions, "applications.read")],
    ["crm", CRM_LINK, can(permissions, "crm.read")],
    ["stores", STORES_LINK, can(permissions, "stores.read")],
  ];
  return all.filter(([key, , allowed]) => key !== current && allowed).map(([, link]) => link);
}

export function productFor(permissions: PermissionSet, current: "admissions" | "crm" | "stores"): SidebarProduct {
  const own = { admissions: { label: "Admissions", home: "/staff" }, crm: { label: "CRM", home: "/staff/crm" }, stores: { label: "Stores", home: "/staff/stores" } }[current];
  return { ...own, switchTo: otherProducts(permissions, current) };
}
