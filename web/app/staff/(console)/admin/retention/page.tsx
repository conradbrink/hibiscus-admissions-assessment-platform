import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { loadRetentionCandidates } from "@/lib/workflow/automation/retention";
import { holdApplication, releaseApplication, runRetentionNow } from "./actions";

/**
 * What the retention run would anonymise next, before it does. Reads
 * through RLS, so a campus team previews its own; the run itself is the
 * drain's, once a day, when the switch is on.
 */
export default async function RetentionPage() {
  const { supabase } = await requireStaff("settings.write");
  const settings = await getSettings(supabase);
  const [{ due, held }, { data: lastRun }, { data: recent }] = await Promise.all([
    loadRetentionCandidates(supabase, settings),
    supabase.from("maintenance_runs").select("*").eq("key", "retention").maybeSingle(),
    supabase.from("applications").select("id, reference, status, anonymised_at, campuses(name)").not("anonymised_at", "is", null).order("anonymised_at", { ascending: false }).limit(20),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  return (
    <>
      <PageTitle
        title="Data retention"
        description={`${settings.retentionEnabled ? "On" : "Off"}: enquiries that went nowhere are anonymised after ${settings.retentionDaysAbandoned} days, closed applications after ${settings.retentionDaysClosed} days. Change these under Workflow settings.`}
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Anonymising removes the child&rsquo;s and family&rsquo;s details, documents, messages and notes. The application row stays with its status, dates, campus and grade, so the analytics keep counting it. A hold keeps an application out of the run until it is released.
        {lastRun ? ` Last run ${formatDateTime(lastRun.last_run_at)}.` : " Not run yet."}
      </p>

      <h2 className="mb-2 text-sm font-semibold">Due now ({due.length})</h2>
      {due.length ? (
        <>
          <div className="mb-3">
            <ActionForm action={runRetentionNow} label={`Anonymise these ${Math.min(due.length, 50)} now`} variant="destructive" size="sm" confirm="Remove the personal data of every application listed as due? This cannot be undone.">
              <span />
            </ActionForm>
          </div>
          <ul className="mb-6 divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {due.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Link href={`/staff/applications/${a.id}`} className="font-medium hover:underline">{a.child_first_name} {a.child_last_name}</Link>
                <span className="font-mono text-xs text-muted-foreground">{a.reference}</span>
                <StatusBadge status={a.status} />
                <span className="text-xs text-muted-foreground">{one(a.campuses)?.name} · since {formatDate(a.status_changed_at)}</span>
                <ActionForm action={holdApplication} label="Hold" size="xs" variant="outline" className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="applicationId" value={a.id} />
                  <Input name="reason" placeholder="Why keep it" className="h-7 w-48 md:h-7" required minLength={3} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mb-6"><EmptyState>Nothing is due.</EmptyState></div>
      )}

      <h2 className="mb-2 text-sm font-semibold">On hold ({held.length})</h2>
      {held.length ? (
        <ul className="mb-6 divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {held.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Link href={`/staff/applications/${a.id}`} className="font-medium hover:underline">{a.child_first_name} {a.child_last_name}</Link>
              <span className="font-mono text-xs text-muted-foreground">{a.reference}</span>
              <Badge variant="warning">held</Badge>
              <span className="text-xs text-muted-foreground">{a.retention_hold_reason}</span>
              <ActionForm action={releaseApplication} label="Release" size="xs" variant="ghost" className="ml-auto">
                <input type="hidden" name="applicationId" value={a.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-6"><EmptyState>No holds.</EmptyState></div>
      )}

      <h2 className="mb-2 text-sm font-semibold">Recently anonymised</h2>
      {recent && recent.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {recent.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="font-mono text-xs">{a.reference}</span>
              <StatusBadge status={a.status} />
              <span className="text-xs text-muted-foreground">{one(a.campuses)?.name} · {formatDateTime(a.anonymised_at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>None yet.</EmptyState>
      )}
    </>
  );
}
