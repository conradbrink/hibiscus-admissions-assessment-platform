import { SignOutButton } from "@/components/staff/sign-out-button";

/**
 * A dead end, not a redirect: a signed-in account with no roles lands here
 * and stays here, rather than looping between pages it cannot open.
 */
export default function NoAccessPage() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-sm">
      <h1 className="text-lg font-semibold">Your account has no access yet.</h1>
      <p className="mt-2 text-muted-foreground">
        You are signed in, but no role has been assigned to your account. Ask an administrator to
        add you under Staff &amp; roles.
      </p>
      <div className="mt-4">
        <SignOutButton />
      </div>
    </div>
  );
}
