import { CampaignForm } from "@/components/crm/campaign-form";
import { PageTitle } from "@/components/staff/page-title";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { activeTemplates } from "@/lib/messaging/send";
import { requireStaff } from "@/lib/staff/session";

/**
 * Step 1 to 3 of the campaign: the kind, the audience, the message. The
 * campaign is saved as a draft and the next steps — preview, count,
 * approval, schedule or send — happen on its own page.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ segment?: string; event?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.campaigns.write");
  const [{ data: segments }, { data: campuses }, { data: templates }, provider, { data: events }] = await Promise.all([
    supabase.from("segments").select("id, name, match_count, campus_id").eq("is_active", true).order("name"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("message_templates").select("*").eq("audience", "family"),
    getMessagingProvider(),
    supabase.from("crm_events").select("id, name, starts_at").eq("is_cancelled", false).gte("starts_at", new Date().toISOString()).order("starts_at"),
  ]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/campaigns", label: "Campaigns" }} title="New campaign" description="Choose the kind, the audience and the message. The recipient count, the preview, the approval and the sending come next, on the campaign's page." />
      <CampaignForm
        segments={segments ?? []}
        campuses={campuses ?? []}
        templates={activeTemplates(templates ?? [], provider.templateIdField).map((t) => ({ key: t.key, name: t.name, body_preview: t.body_preview, parameters: t.parameters }))}
        events={(events ?? []).map((e) => ({ id: e.id, name: e.name }))}
        providerName={provider.name}
        preset={{ segmentId: sp.segment, eventId: sp.event }}
      />
    </>
  );
}
