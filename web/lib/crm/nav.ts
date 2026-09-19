import type { NavGroup, NavItem } from "@/components/staff/nav-items";
import { canAccessPath, type PermissionSet } from "@/lib/permissions";

/**
 * The CRM's own rail, as data, in the same shape as the admissions one so
 * the sidebar draws both. Each item names the permission it needs, and
 * `visibleCrmGroups` also asks `canAccessPath`, so the rail can never offer
 * a link the proxy would bounce.
 */
export const CRM_HOME = "/staff/crm";

export const CRM_NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/staff/crm", label: "Dashboard", icon: "dashboard", permission: "crm.read" }],
  },
  {
    label: "People",
    items: [
      { href: "/staff/crm/families", label: "Families", icon: "families", permission: "crm.read" },
      { href: "/staff/crm/contacts", label: "Contacts", icon: "contacts", permission: "crm.read" },
      { href: "/staff/crm/students", label: "Students", icon: "students", permission: "students.read" },
    ],
  },
  {
    label: "Relationships",
    items: [
      { href: "/staff/crm/opportunities", label: "Opportunities", icon: "opportunities", permission: "crm.read" },
      { href: "/staff/crm/tasks", label: "Tasks", icon: "tasks", permission: "crm.read" },
      { href: "/staff/crm/events", label: "Events", icon: "events", permission: "crm.read" },
    ],
  },
  {
    label: "Communications",
    items: [
      { href: "/staff/crm/inbox", label: "Inbox", icon: "inbox", permission: "crm.read" },
      { href: "/staff/crm/whatsapp", label: "WhatsApp", icon: "whatsapp", permission: "crm.read" },
      { href: "/staff/crm/email", label: "Email", icon: "email", permission: "crm.read" },
      { href: "/staff/crm/campaigns", label: "Campaigns", icon: "campaigns", permission: "crm.read" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/staff/crm/segments", label: "Segments", icon: "segments", permission: "crm.read" },
      { href: "/staff/crm/automations", label: "Automations", icon: "automations", permission: "crm.read" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/staff/crm/analytics", label: "Analytics", icon: "analytics", permission: "analytics.read" },
      { href: "/staff/crm/reports", label: "Reports", icon: "reports", permission: "crm.export" },
    ],
  },
  {
    label: null,
    items: [{ href: "/staff/crm/settings", label: "Settings", icon: "settings", permission: "crm.read" }],
  },
];

/** Everything behind CRM → Settings. */
export const CRM_SETTINGS_SECTIONS: NavGroup[] = [
  {
    label: "The relationship",
    items: [
      { href: "/staff/crm/settings/lifecycle", label: "Lifecycle stages", icon: "lifecycle", permission: "crm.read", blurb: "How a family moves from enquiry to alumni, and what moves it" },
      { href: "/staff/crm/settings/tags", label: "Tags", icon: "tags", permission: "crm.read", blurb: "The tags in use across families" },
      { href: "/staff/crm/settings/lead-sources", label: "Lead sources", icon: "leadSources", permission: "crm.read", blurb: "The answers to \"how did you hear about us?\"" },
      { href: "/staff/admin/campuses", label: "Campuses", icon: "campuses", permission: "settings.write", blurb: "Names, addresses and phone numbers (shared with Admissions)" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/staff/crm/settings/opportunity-types", label: "Opportunity types", icon: "opportunities", permission: "settings.write", blurb: "What the school offers beyond the place, and what each is worth" },
      { href: "/staff/crm/settings/opportunity-rules", label: "Opportunity rules", icon: "rules", permission: "settings.write", blurb: "How the engine finds a family to offer something to" },
      { href: "/staff/crm/automations", label: "Automations", icon: "automations", permission: "settings.write", blurb: "When this happens, do these" },
      { href: "/staff/crm/settings/approvals", label: "Campaign approval", icon: "approvals", permission: "settings.write", blurb: "Who signs off a campaign, and which kinds need a senior signature" },
    ],
  },
  {
    label: "Channels",
    items: [
      { href: "/staff/crm/settings/email", label: "Email", icon: "email", permission: "settings.write", blurb: "The provider, the sending address, and what is switched on" },
      { href: "/staff/crm/settings/whatsapp", label: "WhatsApp", icon: "whatsapp", permission: "settings.write", blurb: "The provider, the webhook, and the templates the school may send" },
      { href: "/staff/admin/templates", label: "Email templates", icon: "email", permission: "templates.write", blurb: "Every email the school sends (shared with Admissions)" },
      { href: "/staff/admin/message-templates", label: "WhatsApp templates", icon: "whatsapp", permission: "templates.write", blurb: "The approved templates (shared with Admissions)" },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/staff/crm/import", label: "Import", icon: "import", permission: "crm.import", blurb: "Families and parents from a spreadsheet, with a preview first" },
      { href: "/staff/crm/reports", label: "Export", icon: "reports", permission: "crm.export", blurb: "Filtered lists as CSV" },
      { href: "/staff/admin/staff", label: "People and permissions", icon: "staff", permission: "staff.write", blurb: "Who can sign in and what they may do (shared with Admissions)" },
    ],
  },
];

function allowed(permissions: PermissionSet, item: NavItem): boolean {
  return (item.permission === undefined || permissions.has("admin") || permissions.has(item.permission)) && canAccessPath(permissions, item.href);
}

export function visibleCrmGroups(permissions: PermissionSet): NavGroup[] {
  return CRM_NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => allowed(permissions, i)) })).filter((g) => g.items.length > 0);
}

export function visibleCrmSettingsSections(permissions: PermissionSet): NavGroup[] {
  return CRM_SETTINGS_SECTIONS.map((g) => ({ label: g.label, items: g.items.filter((i) => allowed(permissions, i)) })).filter((g) => g.items.length > 0);
}
