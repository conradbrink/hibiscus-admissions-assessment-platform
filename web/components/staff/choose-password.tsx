import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reasonText, type InviteLookup, type InvitePurpose } from "@/lib/staff/invites";
import { acceptInvite } from "@/app/staff/(auth)/invite/[token]/actions";

/**
 * The one form that sets a staff password from an emailed link, whether the
 * link was an invitation or a reset. The two differ only in what they say:
 * "Welcome" to somebody joining, "choose a new password" to somebody who
 * has been here for years — and in where a dead link sends them next.
 */
export function ChoosePassword({ token, lookup, purpose }: { token: string; lookup: InviteLookup; purpose: InvitePurpose }) {
  if (!lookup.ok) {
    return (
      <div className="space-y-3 surface p-6">
        <h1 className="text-lg font-semibold">This link cannot be used</h1>
        <p className="text-sm text-muted-foreground">{reasonText(lookup.reason, purpose)}</p>
        {purpose === "reset" ? (
          <Link href="/staff/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Ask for a new link
          </Link>
        ) : (
          <Link href="/staff/login" className="text-sm font-medium text-primary hover:underline">
            Go to the sign-in page
          </Link>
        )}
      </div>
    );
  }

  const firstName = lookup.fullName.split(" ")[0];
  return (
    <ActionForm action={acceptInvite} label={lookup.purpose === "reset" ? "Save my password and sign in" : "Set my password and sign in"} size="lg" className="space-y-4 surface p-6">
      <input type="hidden" name="token" value={token} />
      <div>
        <h1 className="text-lg font-semibold">{lookup.purpose === "reset" ? `Choose a new password, ${firstName}` : `Welcome, ${firstName}`}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {lookup.purpose === "reset" ? "A new password for" : "Choose a password for"} {lookup.email}. At least 12 characters; a short phrase you will remember is ideal.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Password again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
    </ActionForm>
  );
}
