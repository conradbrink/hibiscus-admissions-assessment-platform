import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format-date";
import type { MessageRow } from "@/lib/supabase/types";

/**
 * The WhatsApp conversation for one applicant: what went, what came back,
 * and why a moment was skipped. Sending by hand is limited to the active
 * templates; there is no free-text box, by design.
 */
export function MessagesPanel({
  applicationId,
  messages,
  templates,
  canSend,
  action,
}: {
  applicationId: string;
  messages: MessageRow[];
  templates: Array<{ key: string; name: string }>;
  canSend: boolean;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const tone = (m: MessageRow) =>
    m.status === "failed" ? "destructive" : m.status === "skipped" || m.status === "queued" ? "muted" : m.direction === "in" ? "default" : "success";
  return (
    <div className="space-y-3">
      {messages.length ? (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={`max-w-xl rounded-xl px-3 py-2 ${m.direction === "in" ? "bg-muted" : "ml-auto bg-success/10"}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(m.sent_at ?? m.received_at ?? m.created_at)}</span>
                <span>{m.direction === "in" ? "from the parent" : m.template_key ?? "sent"}</span>
                <Badge variant={tone(m)} className="ml-auto">{m.status}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{m.rendered_text || (m.status === "skipped" ? <span className="text-muted-foreground">Not sent: {m.error}</span> : m.error)}</p>
              {m.status === "failed" && m.rendered_text ? <p className="mt-1 text-xs text-destructive">{m.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No WhatsApp messages yet. Messages go beside emails once the parent opts in and the switch is on.</p>
      )}
      {canSend ? (
        templates.length ? (
          <ActionForm action={action} label="Send template" variant="outline" size="sm" className="border-t border-border pt-3">
            <input type="hidden" name="applicationId" value={applicationId} />
            <NativeSelect name="templateKey" defaultValue={templates[0]?.key} className="w-64">
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Only approved templates can be sent. A reply from the parent becomes a task; answer it by phone or email.</p>
          </ActionForm>
        ) : (
          <p className="text-xs text-muted-foreground">No active templates to send by hand. Set up → WhatsApp templates.</p>
        )
      ) : null}
    </div>
  );
}
