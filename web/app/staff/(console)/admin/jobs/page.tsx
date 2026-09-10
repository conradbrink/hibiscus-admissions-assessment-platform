import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, hoursAgoIso } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { drainHealth } from "@/lib/workflow/drain-health";
import { drainNow, retryJob } from "./actions";

export default async function JobsPage() {
  const { supabase } = await requireStaff("admin");
  const dayAgo = hoursAgoIso(24);
  const [{ data: jobs }, { data: lastScheduled }, { count: scheduledToday }] = await Promise.all([
    supabase.from("jobs").select("*, applications(reference)").order("created_at", { ascending: false }).limit(200),
    supabase.from("drain_runs").select("ran_at").eq("source", "schedule").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("drain_runs").select("id", { count: "exact", head: true }).eq("source", "schedule").gte("ran_at", dayAgo),
  ]);
  // Every five minutes for a day is 288. Showing what arrived against what
  // was asked for is the whole point: a schedule that claims five minutes and
  // delivers seven runs a day looked healthy for months.
  const health = drainHealth(lastScheduled?.ran_at ?? null);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const tone = (s: string) => (s === "failed" ? "destructive" : s === "done" ? "success" : s === "skipped" ? "muted" : s === "running" ? "warning" : "info");

  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }} title="Job queue" description="Emails and scheduled follow-ups. The queue drains after every request that puts work on it, and on a five-minute schedule for the work nobody triggered.">
        <ActionForm action={drainNow} label="Run pending now" size="sm" variant="outline" />
      </PageTitle>

      <section aria-label="Schedule" className="mb-4 surface p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={health.tone}>
            {health.tone === "success" ? "On schedule" : health.tone === "warning" ? "Running late" : "Not running"}
          </Badge>
          <span>{health.phrase}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {scheduledToday ?? 0} scheduled {scheduledToday === 1 ? "run" : "runs"} in the last 24 hours, out of the 288 a
          five-minute schedule asks for. Reminders, the weekday sittings and the nightly sweeps are the work that depends
          on this; anything a parent or a member of staff does drains the queue by itself.
        </p>
      </section>
      {jobs && jobs.length > 0 ? (
        <div className="overflow-x-auto surface">
          <table className="data-table text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Applicant</th>
                <th className="px-3 py-2 font-medium">Runs</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last error</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-3 py-1.5"><span className="font-mono">{j.type}</span><span className="block text-muted-foreground">{(j.payload as { template_key?: string })?.template_key ?? ""}</span></td>
                  <td className="px-3 py-1.5">{one(j.applications)?.reference ?? "—"}</td>
                  <td className="px-3 py-1.5">{formatDateTime(j.run_after)}<span className="block text-muted-foreground">{j.attempts}/{j.max_attempts} attempts</span></td>
                  <td className="px-3 py-1.5"><Badge variant={tone(j.status)}>{j.status}</Badge></td>
                  <td className="max-w-xs truncate px-3 py-1.5 text-muted-foreground" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>
                  <td className="px-3 py-1.5">
                    {j.status === "failed" || j.status === "skipped" ? (
                      <ActionForm action={retryJob} label="Retry" size="xs" variant="outline"><input type="hidden" name="jobId" value={j.id} /></ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>The queue is empty.</EmptyState>
      )}
    </>
  );
}
