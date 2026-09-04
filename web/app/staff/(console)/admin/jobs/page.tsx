import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { drainNow, retryJob } from "./actions";

export default async function JobsPage() {
  const { supabase } = await requireStaff("admin");
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, applications(reference)")
    .order("created_at", { ascending: false })
    .limit(200);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const tone = (s: string) => (s === "failed" ? "destructive" : s === "done" ? "success" : s === "skipped" ? "muted" : s === "running" ? "warning" : "info");

  return (
    <>
      <PageTitle title="Job queue" description="Emails and scheduled follow-ups. Runs after every request that queues work, and every five minutes by cron.">
        <ActionForm action={drainNow} label="Run pending now" size="sm" variant="outline" />
      </PageTitle>
      {jobs && jobs.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
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
