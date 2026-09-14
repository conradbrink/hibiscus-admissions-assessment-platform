import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * Asking for a reset link. The link is ours — minted and emailed by the
 * application, exactly as an invitation is — because Supabase's own recovery
 * email never reached anybody here.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="surface p-6">
      <h1 className="text-lg font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Link href="/staff/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
