import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The facts for families who enquired in a period, read through RLS. One
 * reader for analytics and for the applicant list it opens, so a step's
 * families are counted and listed from the same rows: the same day
 * boundaries, the same campus, the same cap.
 *
 * Ordered, so the cap keeps the same 5,000 on both reads and a page of the
 * list is the same page each time it is read: without an order the view
 * returns its rows in whatever order the plan produced, and two reads past
 * the cap, or two pages over families imported in one transaction (one
 * `created_at` between them), could disagree.
 */
export function readFacts(supabase: SupabaseClient<Database>, range: { from: string; to: string }, campus?: string) {
  let q = supabase
    .from("v_application_facts")
    .select("*")
    .gte("enquired_at", `${range.from}T00:00:00+02:00`)
    .lte("enquired_at", `${range.to}T23:59:59+02:00`)
    .order("enquired_at", { ascending: false })
    .order("application_id", { ascending: true })
    .limit(5000);
  if (campus) q = q.eq("campus_id", campus);
  return q;
}
