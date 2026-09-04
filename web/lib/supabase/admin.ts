import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type AdminClient = SupabaseClient<Database>;

/**
 * The service-role client. **Bypasses row-level security entirely.**
 *
 * This is the client the workflow engine, the job drain, the webhook handlers
 * and every parent-facing route use, because parents are not database
 * principals and there is no RLS to run as. Which means there is also no RLS
 * to catch a mistake: every query made with this client must scope itself.
 *
 * `server-only` at the top makes importing this from a client component a
 * build error rather than a runtime leak of the service-role key.
 *
 * Constructed per call rather than cached at module scope so that a missing
 * key fails the request that needed it, not the build. `next build` runs with
 * placeholder Supabase values in CI and must not need the real secret.
 */
export function createAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The server cannot act on applications without it."
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
