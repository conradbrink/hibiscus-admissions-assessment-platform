import type { Metadata } from "next";
import { FreshLinkForm } from "@/components/applicant/fresh-link-form";

export const metadata: Metadata = { title: "Get a new link" };

/** Where an expired or missing link lands: one field, and the same reply whatever is typed. */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ expired?: string; withdrawn?: string; busy?: string }> }) {
  const { expired, withdrawn, busy } = await searchParams;
  return (
    <div className="max-w-lg pb-8">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {withdrawn ? "Your application is withdrawn" : expired ? "This link has expired" : "Continue your application"}
      </h1>
      <p className="mt-3 text-[16px] text-muted-foreground">
        {withdrawn
          ? "We have emailed you to confirm. Thank you for your interest in Hibiscus International Schools."
          : busy
            ? "Too many links were opened from here in a short time. Wait a few minutes, or ask for a new link below."
            : "Enter the email address you applied with, and we will send you a new link."}
      </p>
      {withdrawn ? null : (
        <div className="mt-6">
          <FreshLinkForm />
        </div>
      )}
    </div>
  );
}
