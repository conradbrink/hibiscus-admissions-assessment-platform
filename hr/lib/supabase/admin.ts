import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type AdminClient = SupabaseClient<Database>;

/**
 * The service-role client. **Bypasses row-level security entirely.**
 *
 * Applicants and referees are not database principals, so every page they
 * open and every answer they save goes through this client, scoped in code by
 * the id in their verified cookie (see `lib/applicant/scope.ts`). Staff writes
 * use it too, after `requireStaffAction` has checked the permission and the
 * row has been read through the staff member's own client.
 *
 * The HR project should hold its own secret key, separate from the admissions
 * app's, so either can be rotated without touching the other.
 */
export function createAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. The HR app cannot act on applications without it.");
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
