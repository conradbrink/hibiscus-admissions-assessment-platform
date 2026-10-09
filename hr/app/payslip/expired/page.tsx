import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";

export const metadata = { title: "Payslip link", robots: { index: false } };

export default async function PayslipExpiredPage({ searchParams }: { searchParams: Promise<{ busy?: string }> }) {
  const busy = (await searchParams).busy;
  return (
    <div className="theme-public flex min-h-screen flex-col">
      <SiteHeader section="Payslip" />
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">{busy ? "Please wait a few minutes" : "This link has closed"}</h1>
        <p className="mt-3 text-[16px] text-muted-foreground">
          {busy
            ? "Too many links were opened from this connection in a short time. Please try your link again in ten minutes."
            : "For your privacy, payslip links stop working after a while, and a payslip stays open for 30 minutes. Open the link in your email again. If the email link has also closed, reply to it and Human Resources will send a new one."}
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
