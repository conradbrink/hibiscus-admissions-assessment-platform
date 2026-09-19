import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { getEmailProvider } from "@/lib/email/provider";
import { requireStaff } from "@/lib/staff/session";

/** What the email channel is set to. Secrets never appear here: only whether each is set. */
export default async function EmailSettingsPage() {
  const { supabase } = await requireStaff("settings.write");
  const provider = await getEmailProvider();
  const { count: templates } = await supabase.from("email_templates").select("id", { count: "exact", head: true }).eq("is_active", true);
  const set = (name: string) => !!process.env[name];
  const rows: Array<[string, string, boolean]> = [
    ["EMAIL_PROVIDER", process.env.EMAIL_PROVIDER ?? "dev (unset)", true],
    ["EMAIL_FROM", process.env.EMAIL_FROM ? "set" : "not set", set("EMAIL_FROM")],
    ["EMAIL_REPLY_TO", process.env.EMAIL_REPLY_TO ? "set" : "not set", set("EMAIL_REPLY_TO")],
    ["RESEND_API_KEY", set("RESEND_API_KEY") ? "set" : "not set", set("RESEND_API_KEY")],
    ["RESEND_WEBHOOK_SECRET", set("RESEND_WEBHOOK_SECRET") ? "set" : "not set", set("RESEND_WEBHOOK_SECRET")],
  ];
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Email" description="The CRM sends through the same provider seam as Admissions. Configuration lives in the deployment's environment variables, never in the browser.">
        <Badge variant={provider.name === "dev" ? "warning" : "success"}>{provider.name}</Badge>
      </PageTitle>
      <section className="surface p-5 text-sm">
        <table className="data-table"><tbody>{rows.map(([k, v, ok]) => <tr key={k}><td className="font-mono text-xs">{k}</td><td>{v}</td><td><Badge variant={ok ? "success" : "muted"}>{ok ? "ok" : "missing"}</Badge></td></tr>)}</tbody></table>
        <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
          <li>Delivery, open, click and bounce events arrive at <code>/api/webhooks/email</code> and update every email, campaigns included.</li>
          <li>Every marketing email carries an unsubscribe link to <code>/unsubscribe/&lt;token&gt;</code>; service messages do not.</li>
          <li>{templates ?? 0} email templates are active. <Link href="/staff/admin/templates" className="underline">Edit them</Link>.</li>
          <li>With the <code>dev</code> provider nothing is sent; every message is readable in the <Link href="/staff/admin/dev-outbox" className="underline">outbox</Link>.</li>
        </ul>
      </section>
    </>
  );
}
