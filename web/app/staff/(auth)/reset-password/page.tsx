import { redirect } from "next/navigation";

/**
 * The bare address used to be where Supabase's recovery email landed. Those
 * emails never arrived, and a reset link now carries its own token
 * (`/staff/reset-password/<token>`), so anyone here without one is sent to
 * ask for a link.
 */
export default function ResetPasswordWithoutToken() {
  redirect("/staff/forgot-password");
}
