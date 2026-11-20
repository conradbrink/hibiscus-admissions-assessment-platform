import { AreaHeader } from "@/components/staff/area-header";

/** Stock Issues is one place with three screens: consumables, assigning an asset, and what is assigned. */
export function IssuesHeader({ current, description }: { current: "issue" | "assign" | "assigned"; description: string }) {
  return (
    <AreaHeader
      title="Stock issues"
      tabsLabel="Stock issues"
      tabs={[
        { label: "Issue consumables", href: "/staff/stores/issues", active: current === "issue" },
        { label: "Assign an asset", href: "/staff/stores/issues/assign", active: current === "assign" },
        { label: "Assigned assets", href: "/staff/stores/issues/assigned", active: current === "assigned" },
      ]}
      description={description}
    />
  );
}
