import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

let browserClient:
  | ReturnType<typeof createBrowserClient<Database>>
  | undefined;

/**
 * The single browser Supabase client, for **staff** pages only.
 *
 * Must be a singleton. Every `createBrowserClient()` call constructs its own
 * GoTrueClient, and each of those takes a `navigator.locks` lock on the shared
 * auth-token key before it will resolve a session. Returning a fresh instance
 * per call leaves many clients contending for one lock, and requests hang
 * forever waiting on a session that never resolves, with no error surfacing.
 *
 * Parent pages never use this. They have no session to resolve — see
 * `lib/supabase/admin.ts` and `lib/tokens`.
 */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
  }
  return browserClient;
}
