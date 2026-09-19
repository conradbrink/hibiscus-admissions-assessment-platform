import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";

/** What the WhatsApp channel is set to, and which family templates can actually be sent through it. */
export default async function WhatsAppSettingsPage() {
  const { supabase } = await requireStaff("settings.write");
  const [provider, settings, { data: templates }] = await Promise.all([getMessagingProvider(), getSettings(supabase), supabase.from("message_templates").select("key, name, is_active, audience, meta_template_name, twilio_content_sid, zavu_template_id").order("key")]);
  const set = (name: string) => !!process.env[name];
  const which = process.env.MESSAGING_PROVIDER ?? "dev";
  const vars: Record<string, string[]> = {
    meta: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
    twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
    zavu: ["ZAVU_API_KEY", "ZAVU_WEBHOOK_SECRET"],
    dev: [],
  };
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="WhatsApp" description="The official WhatsApp Business Platform, through Meta's Cloud API, Twilio or Zavu. Templates are approved in the provider's own dashboard; the CRM sends nothing that is not one.">
        <Badge variant={provider.name === "dev" ? "warning" : "success"}>{provider.name}</Badge>
        <Badge variant={settings.whatsappEnabled ? "success" : "muted"}>{settings.whatsappEnabled ? "sending on" : "sending off"}</Badge>
      </PageTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="surface p-5 text-sm">
          <h2 className="mb-2 font-semibold">Configuration</h2>
          <table className="data-table"><tbody>
            <tr><td className="font-mono text-xs">MESSAGING_PROVIDER</td><td>{which}</td><td /></tr>
            {(vars[which] ?? []).map((k) => <tr key={k}><td className="font-mono text-xs">{k}</td><td>{set(k) ? "set" : "not set"}</td><td><Badge variant={set(k) ? "success" : "muted"}>{set(k) ? "ok" : "missing"}</Badge></td></tr>)}
            <tr><td className="font-mono text-xs">whatsapp_enabled</td><td>{String(settings.whatsappEnabled)}</td><td><Link href="/staff/admin/settings" className="text-xs underline">change</Link></td></tr>
          </tbody></table>
          <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
            <li>Webhook: <code>/api/webhooks/whatsapp</code>, for delivery receipts and replies. Register it with the provider.</li>
            <li>A reply lands in the inbox and on the family; STOP switches the parent off, START back on.</li>
            <li>A campaign sends only to contacts who opted in to updates <em>and</em> consented to marketing on WhatsApp, unless it is a service message.</li>
          </ul>
        </section>
        <section className="surface p-5 text-sm">
          <h2 className="mb-2 font-semibold">Family templates</h2>
          <p className="mb-2 text-xs text-muted-foreground">A template can be sent when it is active and carries the live provider&rsquo;s id ({provider.templateIdField}).</p>
          <ul className="divide-y divide-border/70">
            {(templates ?? []).filter((t) => t.audience === "family").map((t) => {
              const id = t[provider.templateIdField];
              return <li key={t.key} className="flex items-center gap-2 py-1.5"><span className="min-w-0 flex-1"><span className="font-medium">{t.name}</span> <span className="text-xs text-muted-foreground">{t.key}</span></span><Badge variant={t.is_active && id ? "success" : "muted"}>{t.is_active && id ? "sendable" : !t.is_active ? "inactive" : "no id"}</Badge></li>;
            })}
          </ul>
          <Link href="/staff/admin/message-templates" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">Edit WhatsApp templates</Link>
        </section>
      </div>
    </>
  );
}
