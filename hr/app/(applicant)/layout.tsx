import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";

export default function ApplicantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-public min-h-dvh">
      <SiteHeader section="Your application" />
      <main className="mx-auto max-w-3xl px-5 pt-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
