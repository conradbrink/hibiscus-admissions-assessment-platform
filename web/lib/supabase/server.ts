import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

/**
 * A Supabase client carrying the signed-in **staff** member's session, for use
 * in server components, server actions and route handlers under /staff.
 *
 * Every query through this client is subject to row-level security as that
 * staff member. That is the point: the database, not this code, decides what
 * they may see.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a server component, which may not set cookies; the
            // proxy refreshes the session cookie so this is safe to ignore.
          }
        },
      },
    }
  );
}
