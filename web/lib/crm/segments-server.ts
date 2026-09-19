import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyRules, gradeBandMatches, needsPostFilter, validateRules, type Rule } from "@/lib/crm/segments";
import type { CrmFamilyFactsRow, Database, Json } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Evaluating a segment against the facts view, under whichever client is
 * asking: the staff client for a count on the screen (so the number is what
 * that person may see), the service role when a campaign is being prepared
 * by the drain.
 */

export function parseRules(raw: Json | null | undefined): Rule[] {
  const v = validateRules(raw ?? []);
  return v.ok ? v.rules : [];
}

/** How many families match. A grade band is finished in memory; everything else is the database's count. */
export async function countSegment(client: Client, rules: readonly Rule[], campusId: string | null, now: Date = new Date()): Promise<number> {
  if (needsPostFilter(rules)) {
    const rows = await listSegment(client, rules, campusId, 5000, now);
    return rows.length;
  }
  let q = client.from("v_crm_family_facts").select("family_id", { count: "exact", head: true });
  if (campusId) q = q.eq("campus_id", campusId);
  q = applyRules(q, rules, now);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** The families that match, up to a cap. */
export async function listSegment(client: Client, rules: readonly Rule[], campusId: string | null, limit = 5000, now: Date = new Date()): Promise<CrmFamilyFactsRow[]> {
  let q = client.from("v_crm_family_facts").select("*");
  if (campusId) q = q.eq("campus_id", campusId);
  q = applyRules(q, rules, now);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CrmFamilyFactsRow[];
  return needsPostFilter(rules) ? rows.filter((r) => gradeBandMatches(r, rules)) : rows;
}
