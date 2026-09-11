import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";

/**
 * The email moments that may also go by WhatsApp. Each row maps our
 * variables onto a template the school had approved with Meta; none is
 * active until that approval exists and its name is entered here.
 */
export default async function MessageTemplatesPage() {
  const { supabase } = await requireStaff("templates.write");
  const [{ data: templates }, { data: emails }, settings] = await Promise.all([
    supabase.from("message_templates").select("*").order("key"),
    supabase.from("email_templates").select("key, name").eq("is_active", true),
    getSettings(supabase),
  ]);
  const emailName = new Map((emails ?? []).map((e) => [e.key, e.name]));

  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }}
        title="WhatsApp templates"
        description={
          settings.whatsappEnabled
            ? "WhatsApp is on: active templates are sent beside their email to parents who opted in."
            : "WhatsApp is off (Workflow settings → whatsapp_enabled). Templates can be prepared and approved meanwhile."
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        A WhatsApp message is always a template the provider has approved in advance; free text is never sent. Open a
        row to enter the id that approval gave it and to activate it.
      </p>
      <ul className="divide-y divide-border surface">
        {(templates ?? []).map((t) => (
          // The whole row is the link. It was the name alone, which looked like
          // plain text on a page whose entire purpose is opening these.
          <li key={t.key}>
            <Link
              href={`/staff/admin/message-templates/${t.key}`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{t.key}</span>
                <p className="truncate text-xs text-muted-foreground">Beside the email “{emailName.get(t.key) ?? t.key}” · Zavu id: {t.zavu_template_id ? "set" : "not set"} · updated {formatDate(t.updated_at)}</p>
              </div>
              <Badge variant={t.is_active ? "success" : "muted"}>{t.is_active ? "Active" : "Inactive"}</Badge>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
