import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { PaymentPanel } from "@/components/staff/payment-panel";
import { StatusBadge } from "@/components/staff/status-badge";
import { daysAgoDateString, formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Finance's queue: what is owed, what is being confirmed, what went wrong,
 * and what came in. Rows are payment requests; the application they belong
 * to is the link. Campus scoping applies through the policies.
 */
export default async function PaymentsPage() {
  const { supabase, permissions } = await requireStaff("finance.read");
  const canWrite = can(permissions, "finance.write");

  const since = `${daysAgoDateString(30)}T00:00:00+02:00`;
  const { data: requests } = await supabase
    .from("payment_requests")
    .select("*, applications(id, reference, status, child_first_name, child_last_name, campuses(name), grades!applications_grade_id_fkey(name))")
    .or(`status.in.(required,processing,failed,partially_paid),and(status.eq.paid,paid_at.gte.${since})`)
    .order("due_at", { ascending: true });
  const ids = (requests ?? []).map((r) => r.id);
  const { data: payments } = ids.length
    ? await supabase.from("payments").select("*").in("payment_request_id", ids).order("created_at", { ascending: false })
    : { data: [] as PaymentRow[] };
  const byRequest = new Map<string, PaymentRow[]>();
  for (const p of payments ?? []) byRequest.set(p.payment_request_id, [...(byRequest.get(p.payment_request_id) ?? []), p]);

  const groups: Array<{ key: string; title: string; note?: string; rows: NonNullable<typeof requests> }> = [
    { key: "outstanding", title: "Outstanding", note: "Overdue first.", rows: (requests ?? []).filter((r) => r.status === "required" || r.status === "partially_paid") },
    { key: "processing", title: "Being confirmed", note: "Online payments the gateway has not yet confirmed. Checked automatically every few minutes.", rows: (requests ?? []).filter((r) => r.status === "processing") },
    { key: "failed", title: "Not completed", note: "The parent has been emailed a link to try again.", rows: (requests ?? []).filter((r) => r.status === "failed") },
    { key: "paid", title: "Paid in the last 30 days", rows: (requests ?? []).filter((r) => r.status === "paid") },
  ];

  const Head = ({ r }: { r: NonNullable<typeof requests>[number] }) => {
    const a = one(r.applications);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/staff/applications/${a?.id}`} className="font-semibold hover:underline">{a?.child_first_name} {a?.child_last_name}</Link>
          <p className="text-xs text-muted-foreground">{one(a?.grades)?.name} · {one(a?.campuses)?.name} · {a?.reference} · requested {formatDateTime(r.created_at)}</p>
        </div>
        {a ? <StatusBadge status={a.status} /> : null}
      </div>
    );
  };

  return (
    <>
      <PageTitle title="Payments" description="Registration and admission fees. An application becomes paid only on a verified gateway payment or a bank transfer recorded here." />
      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h2 className="mb-1 text-sm font-semibold">{g.title} ({g.rows.length})</h2>
          {g.note ? <p className="mb-2 text-xs text-muted-foreground">{g.note}</p> : null}
          {g.rows.length ? (
            <div className="space-y-3">
              {g.rows.map((r) => {
                const a = one(r.applications);
                // Strip the embedded application before handing the row to the panel.
                const request = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "applications"));
                return (
                  <section key={r.id} className="rounded-xl border border-border bg-card p-4">
                    <Head r={r} />
                    <div className="mt-3">
                      <PaymentPanel applicationId={a?.id ?? ""} request={request as PaymentRequestRow} payments={byRequest.get(r.id) ?? []} canWrite={canWrite && !!a} />
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <EmptyState>None.</EmptyState>
          )}
        </section>
      ))}
    </>
  );
}
