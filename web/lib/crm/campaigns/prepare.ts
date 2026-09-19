import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXCLUSION_LABELS, planRecipients, type RecipientContact, type RecipientPlan } from "@/lib/crm/recipients";
import { listSegment, parseRules } from "@/lib/crm/segments-server";
import type { AdminClient } from "@/lib/supabase/admin";
import type { CampaignRow, Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Preparing a campaign: turning its segment into the frozen recipient list
 * the approver reads and the drain sends from.
 *
 * The audience is read through the *staff* client, so the list is exactly
 * what the person preparing it may see — a campus marketer cannot reach
 * another campus's families by naming a group-wide segment. The rows are
 * then written under the service role, which is the only writer of
 * `campaign_recipients`.
 *
 * Preparing again replaces the list. The counts on the campaign row are
 * what the approver saw; the rows are what will be sent.
 */
export type PreparedCampaign = RecipientPlan & { exclusionSummary: Array<{ reason: string; count: number }> };

export async function prepareCampaign(staff: Client, admin: AdminClient, campaign: CampaignRow): Promise<PreparedCampaign> {
  const { data: segment } = campaign.segment_id
    ? await staff.from("segments").select("*").eq("id", campaign.segment_id).maybeSingle()
    : { data: null };
  const rules = segment ? parseRules(segment.rules) : [];
  const families = await listSegment(staff, rules, campaign.campus_id ?? segment?.campus_id ?? null);
  const familyIds = families.map((f) => f.family_id);

  const contacts: RecipientContact[] = [];
  // In pages of 200: a PostgREST `in` list has a length limit, and a
  // campaign to every family at the school is a few thousand ids.
  for (let i = 0; i < familyIds.length; i += 200) {
    const slice = familyIds.slice(i, i + 200);
    const { data, error } = await staff
      .from("contacts")
      .select("id, family_id, first_name, last_name, email, mobile_normalised, whatsapp_opt_in, marketing_email_consent, marketing_whatsapp_consent, unsubscribed_at, is_active")
      .in("family_id", slice);
    if (error) throw new Error(error.message);
    const primaryOf = new Map(families.map((f) => [f.family_id, f.primary_contact_id]));
    for (const c of data ?? []) {
      if (!c.family_id) continue;
      contacts.push({
        ...c,
        family_id: c.family_id,
        // A family with no primary named yet: its first contact stands in.
        is_primary: primaryOf.get(c.family_id) ? primaryOf.get(c.family_id) === c.id : !contacts.some((x) => x.family_id === c.family_id),
      });
    }
  }

  const plan = planRecipients(contacts, { channel: campaign.channel, category: campaign.category });

  // Replace the list under the service role.
  const del = await admin.from("campaign_recipients").delete().eq("campaign_id", campaign.id);
  if (del.error) throw new Error(del.error.message);
  const rows = [
    ...plan.recipients.map((r) => ({ campaign_id: campaign.id, family_id: r.familyId, contact_id: r.contactId, channel: r.channel, status: "pending" as const })),
    ...plan.excluded
      // "Not the primary contact" is not worth a row per second parent; the
      // count is enough. Everything else is a person who will not hear from
      // us and why, which the approver may want to see by name.
      .filter((e) => e.reason !== "not_primary")
      .map((e) => ({ campaign_id: campaign.id, family_id: e.familyId, contact_id: e.contactId, channel: e.channel, status: "excluded" as const, exclusion_reason: e.reason })),
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("campaign_recipients").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  const exclusionSummary = Object.entries(plan.exclusionCounts)
    .map(([reason, count]) => ({ reason: EXCLUSION_LABELS[reason as keyof typeof EXCLUSION_LABELS] ?? reason, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const { error } = await admin
    .from("campaigns")
    .update({
      prepared_at: new Date().toISOString(),
      recipients_total: plan.familiesReached,
      recipients_email: plan.email,
      recipients_whatsapp: plan.whatsapp,
      excluded_count: plan.excluded.filter((e) => e.reason !== "not_primary").length,
      exclusions: plan.exclusionCounts,
    })
    .eq("id", campaign.id);
  if (error) throw new Error(error.message);

  return { ...plan, exclusionSummary };
}
