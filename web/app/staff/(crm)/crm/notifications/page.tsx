import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_KIND_LABELS } from "@/lib/crm/labels";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { markAllRead, markRead } from "./actions";

/** This person's notices, unread first. Nobody else's: the policy is `staff_id = auth.uid()`. */
export default async function NotificationsPage() {
  const { supabase } = await requireStaff("crm.read");
  const { data: rows } = await supabase.from("notifications").select("*").order("read_at", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false }).limit(200);
  const unread = (rows ?? []).filter((r) => !r.read_at).length;
  return (
    <>
      <PageTitle title="Notifications" description={unread ? `${unread} unread.` : "You are up to date."}>
        {unread ? <ActionForm action={markAllRead} label="Mark all read" variant="outline" size="sm" /> : null}
      </PageTitle>
      {rows && rows.length ? (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className={`flex flex-wrap items-center gap-3 surface px-4 py-3 text-sm ${n.read_at ? "opacity-60" : ""}`}>
              <Badge variant={n.read_at ? "muted" : "info"}>{NOTIFICATION_KIND_LABELS[n.kind]}</Badge>
              <div className="min-w-0 flex-1">
                {n.href ? <Link href={n.href} className="font-medium hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
                <p className="text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</p>
              </div>
              {!n.read_at ? (
                <ActionForm action={markRead} label="Read" size="xs" variant="ghost">
                  <input type="hidden" name="id" value={n.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Nothing yet. Replies, assigned tasks and campaigns waiting for you will appear here.</EmptyState>
      )}
    </>
  );
}
