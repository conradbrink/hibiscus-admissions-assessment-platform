import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format-date";
import { deliveryProof } from "@/lib/messaging/delivery";
import type { MessageEventRow, MessageRow } from "@/lib/supabase/types";

/**
 * The WhatsApp conversation for one applicant: what went, what came back,
 * why a moment was skipped — and, under each message, the trail of what the
 * provider said about it and when.
 *
 * The trail matters because "sent" has been misleading the office. WhatsApp
 * accepts a template and returns an id long before anything reaches a phone,
 * so an accepted message with a malformed button reads exactly like a
 * delivered one. Each message now leads with what is actually known about it,
 * and the receipts behind that sit one click away.
 *
 * Sending by hand is limited to the active templates; there is no free-text
 * box, by design.
 */
export function MessagesPanel({
  applicationId,
  messages,
  events,
  templates,
  canSend,
  action,
}: {
  applicationId: string;
  messages: MessageRow[];
  events: MessageEventRow[];
  templates: Array<{ key: string; name: string }>;
  canSend: boolean;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const tone = (m: MessageRow) =>
    m.status === "failed" ? "destructive" : m.status === "skipped" || m.status === "queued" ? "muted" : m.direction === "in" ? "default" : "success";

  const trailFor = (messageId: string) => events.filter((e) => e.message_id === messageId);

  return (
    <div className="space-y-3">
      {messages.length ? (
        <ul className="space-y-2">
          {messages.map((m) => {
            const proof = deliveryProof(m);
            const trail = trailFor(m.id);
            return (
              <li key={m.id} className={`max-w-xl rounded-xl px-3 py-2 ${m.direction === "in" ? "bg-muted" : "ml-auto bg-success/10"}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDateTime(m.sent_at ?? m.received_at ?? m.created_at)}</span>
                  <span>{m.direction === "in" ? "from the parent" : m.template_key ?? "sent"}</span>
                  <Badge variant={tone(m)} className="ml-auto">{m.status}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap">
                  {m.rendered_text || (m.status === "skipped" ? <span className="text-muted-foreground">Not sent: {m.error}</span> : m.error)}
                </p>
                {/* The one line the office actually needs: did it arrive? */}
                <p className={`mt-1 text-xs ${proof.confirmed ? "text-success" : m.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                  {proof.confirmed ? "✓ " : ""}
                  {proof.summary}
                  {m.direction === "out" && m.trigger_source === "manual" ? " · sent by hand" : ""}
                </p>
                {trail.length ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">
                      Delivery history ({trail.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 border-l border-border pl-2">
                      {trail.map((e) => (
                        <li key={e.id} className={e.applied ? "" : "text-muted-foreground"}>
                          <span className="font-mono">{e.status}</span>
                          <span className="text-muted-foreground"> · {formatDateTime(e.occurred_at)}</span>
                          {e.actor_label ? <span className="text-muted-foreground"> · {e.actor_label}</span> : null}
                          {/* An assertion that arrived too late to matter is
                              kept and marked, not hidden: it is exactly what
                              you want when the delivery looks wrong. */}
                          {e.applied ? null : <span className="text-muted-foreground"> · not applied</span>}
                          {e.detail ? <span className="block text-muted-foreground">{e.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
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
