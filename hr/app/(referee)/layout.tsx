import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";

export default function RefereeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-public min-h-dvh">
      <SiteHeader section="Reference" />
      <main className="mx-auto max-w-2xl px-5 pt-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
