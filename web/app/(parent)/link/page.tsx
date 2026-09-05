import type { Metadata } from "next";
import Link from "next/link";
import { FreshLinkForm } from "@/components/parent/fresh-link-form";
import { PageHeader } from "@/components/parent/page-header";
import { requestFreshLink } from "./actions";

export const metadata: Metadata = { title: "Get a new link" };

const REASONS: Record<string, string> = {
  expired: "That link has expired. Links stop working after a while to keep your details safe.",
  revoked: "That link is no longer valid.",
  exhausted: "That link has already been used.",
  unknown: "We did not recognise that link.",
  busy: "Too many attempts from this connection. Please wait a minute and try again.",
  "1": "Your session has timed out.",
};

export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  const reason = REASONS[sp.reason ?? sp.expired ?? ""] ?? null;

  return (
    <>
      <PageHeader
        title="Get a new link"
        description="Enter the email address you enquired with and your reference, and we will send a fresh link to your application."
      />
      {reason ? (
        <p className="mb-5 rounded-lg bg-muted px-4 py-3 text-sm text-foreground" role="status">
          {reason}
        </p>
      ) : null}
      <FreshLinkForm action={requestFreshLink} />
      <p className="mt-8 text-sm text-muted-foreground">
        Not enquired yet?{" "}
        <Link href="/join" className="font-medium text-foreground underline underline-offset-2">
          Take the first step
        </Link>
      </p>
    </>
  );
}
