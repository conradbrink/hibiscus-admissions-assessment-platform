import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findStaffInvite, reasonText } from "@/lib/staff/invites";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptInvite } from "./actions";

/**
 * Where an invited member of staff chooses their password. Opening this page
 * reads the invitation but does not spend it, so a link scanner cannot use
 * it up before the person clicks.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findStaffInvite(createAdminClient(), token);

  if (!invite.ok) {
    return (
      <div className="space-y-3 surface p-6">
        <h1 className="text-lg font-semibold">This link cannot be used</h1>
        <p className="text-sm text-muted-foreground">{reasonText(invite.reason)}</p>
        <Link href="/staff/login" className="text-sm font-medium text-primary hover:underline">
          Go to the sign-in page
        </Link>
      </div>
    );
  }

  return (
    <ActionForm action={acceptInvite} label="Set my password and sign in" size="lg" className="space-y-4 surface p-6">
      <input type="hidden" name="token" value={token} />
      <div>
        <h1 className="text-lg font-semibold">Welcome, {invite.fullName.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a password for {invite.email}. At least 12 characters; a short phrase you will remember is ideal.
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
