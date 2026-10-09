import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** The campuses this member of staff may work with, for pickers. */
export async function accessibleCampuses(client: SupabaseClient<Database>): Promise<{ id: string; name: string; country: "BW" | "ZA" }[]> {
  const { data } = await client.from("campuses").select("id, name, country, is_active, sort_order").eq("is_active", true).order("sort_order");
  const out: { id: string; name: string; country: "BW" | "ZA" }[] = [];
  for (const c of data ?? []) {
    const { data: ok } = await client.rpc("can_access_campus", { p_campus_id: c.id });
    if (ok) out.push({ id: c.id, name: c.name, country: c.country });
  }
  return out;
}
