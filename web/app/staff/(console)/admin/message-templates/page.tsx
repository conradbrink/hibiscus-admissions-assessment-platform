import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { accountIsBlocked, summariseFailures } from "@/lib/messaging/failure-kind";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";

/**
 * The email moments that may also go by WhatsApp. Each row maps our
 * variables onto a template the school had approved with Meta; none is
 * active until that approval exists and its name is entered here.
 */
export default async function MessageTemplatesPage() {
  const { supabase } = await requireStaff("templates.write");
  // A week of failures, per template. The reason this exists: the pre-school
  // enquiry confirmation failed at the provider for a full day — every single
  // send — and nothing anywhere said so. It was found only because somebody
  // happened to have the provider's own inbox open. A template that is
  // refusing to send is the most urgent thing this page can tell you, so it
  // says it on the row, with the provider's own words.
  //
  // But only its own failures. A number that is not on WhatsApp fails against
  // whichever template happened to be sending at the time, so for a fortnight
  // two unreachable parents marked eight healthy templates as failing — and
  // the one template that really was broken looked no worse than the noise.
  // `summariseFailures` splits the two: a parent's handset is not this page's
  // business, and the email reached them anyway.
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: templates }, { data: emails }, { data: failures }, settings] = await Promise.all([
    supabase.from("message_templates").select("*").order("key"),
    supabase.from("email_templates").select("key, name").eq("is_active", true),
    supabase
      .from("messages")
      .select("template_key, error, created_at, to_normalised")
      .eq("status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    getSettings(supabase),
  ]);
  const emailName = new Map((emails ?? []).map((e) => [e.key, e.name]));
  const failed = summariseFailures(failures ?? []);
  // One blocked sender stops every template, and would otherwise light the
  // whole list up as though each were separately broken.
  const account = accountIsBlocked(failures ?? []);

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
      {account.blocked ? (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="font-semibold">The WhatsApp sender itself is blocked at the provider.</span> Nothing is
          sending, whatever the rows below say, and no change here will fix it — it is settled in the provider&rsquo;s
          console. {account.error}
        </p>
      ) : null}
      <p className="mb-4 text-sm text-muted-foreground">
        A WhatsApp message is always a template the provider has approved in advance; free text is never sent. Open a
        row to enter the id that approval gave it and to activate it.
      </p>
      <ul className="divide-y divide-border surface">
        {(templates ?? []).map((t) => {
          const f = failed.get(t.key);
          const broken = (f?.template.count ?? 0) > 0;
          const unreachable = f?.recipient ?? { count: 0, numbers: 0 };
          return (
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
                  {broken ? (
                    <p className="mt-1 text-xs font-medium text-destructive">
                      {f!.template.count} failed to send in the last 7 days
                      {f!.template.error ? <span className="font-normal"> · {f!.template.error}</span> : null}
                    </p>
                  ) : null}
                  {unreachable.count ? (
                    // Deliberately not red, and it says outright that the
                    // template is fine: somebody chasing a red badge here
                    // would be chasing nothing.
                    <p className="mt-1 text-xs text-muted-foreground">
                      {unreachable.count === 1 ? "1 message" : `${unreachable.count} messages`} could not reach{" "}
                      {unreachable.numbers === 1 ? "a parent" : `${unreachable.numbers} parents`} on WhatsApp — their
                      number, not this template. The email was sent.
                    </p>
                  ) : null}
                </div>
                {broken ? <Badge variant="destructive">Failing</Badge> : null}
                <Badge variant={t.is_active ? "success" : "muted"}>{t.is_active ? "Active" : "Inactive"}</Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
