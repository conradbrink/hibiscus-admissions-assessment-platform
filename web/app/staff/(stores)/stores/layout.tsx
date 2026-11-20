import type { Metadata, Viewport } from "next";
import { productFor } from "@/components/staff/products";
import { StaffSidebar } from "@/components/staff/sidebar";
import { StaffTopbar } from "@/components/staff/topbar";
import { StoresBottomNav, type BottomNavItem } from "@/components/stores/bottom-nav";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { visibleStoresGroups } from "@/lib/stores/nav";

export const metadata: Metadata = {
  title: { default: "Hibiscus Stores", template: "%s · Hibiscus Stores" },
  // Installable from the phone's browser: Add to Home Screen opens Stores in
  // its own window. There is no service worker and no offline mode, on
  // purpose: a checkout is only real once the database has it, so the app
  // says so when it cannot reach the server rather than pretending it saved.
  manifest: "/stores/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Stores", statusBarStyle: "default" },
  icons: { apple: "/stores/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  // The bottom bar pads itself by the home indicator; without `cover` an
  // iPhone reports that inset as zero.
  viewportFit: "cover",
};

/**
 * The Stores shell: the same rail and strip as the admissions console, drawn
 * with Stores' own nine places, and on a phone a bar of the storeroom's
 * everyday actions under the thumb. The proxy has already refused anyone
 * without `stores.read`.
 */
export default async function StoresLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff("stores.read");
  const groups = visibleStoresGroups(ctx.permissions);
  const writer = can(ctx.permissions, "stores.write");
  const bottom: BottomNavItem[] = writer
    ? [
        { href: "/staff/stores", label: "Home", icon: "dashboard", exact: true },
        { href: "/staff/stores/check-out", label: "Check out", icon: "checkOut" },
        { href: "/staff/stores/check-in", label: "Check in", icon: "checkIn" },
        { href: "/staff/stores/issues", label: "Issue", icon: "stockIssues" },
        { href: "/staff/stores/inventory", label: "Inventory", icon: "inventory" },
      ]
    : [
        { href: "/staff/stores", label: "Home", icon: "dashboard", exact: true },
        { href: "/staff/stores/inventory", label: "Inventory", icon: "inventory" },
        { href: "/staff/stores/movements", label: "Movements", icon: "movements" },
        { href: "/staff/stores/reports", label: "Reports", icon: "reports" },
      ];
  return (
    <div className="staff-console staff-shell flex min-h-dvh flex-col bg-background md:flex-row print:block print:min-h-0 print:bg-white">
      <StaffSidebar
        groups={groups}
        name={ctx.profile.full_name ?? ""}
        email={ctx.profile.email}
        product={productFor(ctx.permissions, "stores")}
        className="md:sticky md:top-0 md:h-dvh"
      />
      <main className="min-w-0 flex-1 px-4 pt-4 pb-28 md:px-8 md:py-7 lg:px-10 print:p-0">
        <div className="mx-auto w-full max-w-6xl print:max-w-none">
          {/* On a phone the bar at the top and the one at the bottom are the
              whole frame; the greeting would push the work below the fold. */}
          <div className="hidden md:block print:block">
            <StaffTopbar
              name={ctx.profile.full_name ?? ""}
              email={ctx.profile.email}
              openTasks={0}
              showTasks={false}
              search={{ action: "/staff/stores/inventory", placeholder: "Find an item" }}
              pdf={can(ctx.permissions, "pages.export_pdf")}
            />
          </div>
          {children}
        </div>
      </main>
      <StoresBottomNav items={bottom} />
    </div>
  );
}
