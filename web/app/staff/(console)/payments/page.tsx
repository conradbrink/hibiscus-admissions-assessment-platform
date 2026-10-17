import Link from "next/link";
import { AdmissionsHeader, loadAdmissionsHeaderData } from "@/components/staff/admissions-header";
import { EmptyState } from "@/components/staff/page-title";
import { PaymentPanel } from "@/components/staff/payment-panel";
import { StatusBadge } from "@/components/staff/status-badge";
import { daysAgoDateString, formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The dashboard's two payment counts, as views of this page. Each holds the
 * same requests its count does, of either kind, so the number clicked is the
 * number found.
 */
const SHOWS = {
  overdue: { title: "Overdue", note: "Owed, past the date it was due.", match: (r: { status: string; due_at: string | null }, now: number) => ["required", "failed", "partially_paid"].includes(r.status) && r.due_at !== null && new Date(r.due_at).getTime() < now },
  failed: { title: "Not completed", note: "The parent has been emailed a link to try again.", match: (r: { status: string }) => r.status === "failed" },
} as const;

/**
 * Finance's queue: what is owed, what is being confirmed, what went wrong, and
 * what came in.
 *
 * Rows are payment requests, and a request has one of three subjects. An
 * admission links to the application; an extras order links to the child; a
 * school transport booking shows its reference. All three embeds are selected
 * because a row has exactly one of them, and rendering whichever is there is
 * what stops a row appearing as a line of blanks — the failure mode a null
 * embed produces silently.
 *
 * Campus scoping applies through the policies, which now read
 * `payment_requests.campus_id` directly rather than joining the application.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const show = sp.show && Object.hasOwn(SHOWS, sp.show) ? SHOWS[sp.show as keyof typeof SHOWS] : null;
  const { supabase, permissions, userId } = await requireStaff("finance.read");
  // The stage bar's reads, started now so they run beside the page's own.
  const header = loadAdmissionsHeaderData(supabase, userId);
  const canWrite = can(permissions, "finance.write");

  const since = `${daysAgoDateString(30)}T00:00:00+02:00`;
  const { data: requests } = await supabase
    .from("payment_requests")
    .select(
      "*, applications(id, reference, status, child_first_name, child_last_name, campuses(name), grades!applications_grade_id_fkey(name)), students(id, student_code, legal_first_name, legal_last_name, preferred_name, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name)), transport_bookings(id, reference, status, parent_first_name, parent_last_name)"
    )
    .or(`status.in.(required,processing,failed,partially_paid),and(status.eq.paid,paid_at.gte.${since})`)
    .order("due_at", { ascending: true });
  const ids = (requests ?? []).map((r) => r.id);
  const { data: payments } = ids.length
    ? await supabase.from("payments").select("*").in("payment_request_id", ids).order("created_at", { ascending: false })
    : { data: [] as PaymentRow[] };
  const byRequest = new Map<string, PaymentRow[]>();
  for (const p of payments ?? []) byRequest.set(p.payment_request_id, [...(byRequest.get(p.payment_request_id) ?? []), p]);

  const admissions = (requests ?? []).filter((r) => r.kind === "admission");
  const extras = (requests ?? []).filter((r) => r.kind === "extras");
  const transport = (requests ?? []).filter((r) => r.kind === "transport");

  const now = new Date().getTime();
  const groups: Array<{ key: string; title: string; note?: string; rows: NonNullable<typeof requests> }> = show
    ? [{ key: "shown", title: show.title, note: show.note, rows: (requests ?? []).filter((r) => show.match(r, now)) }]
    : [
      { key: "outstanding", title: "Outstanding", note: "Overdue first.", rows: admissions.filter((r) => r.status === "required" || r.status === "partially_paid") },
      { key: "processing", title: "Being confirmed", note: "Online payments the gateway has not yet confirmed. Checked automatically every few minutes.", rows: admissions.filter((r) => r.status === "processing") },
      { key: "failed", title: "Not completed", note: "The parent has been emailed a link to try again.", rows: admissions.filter((r) => r.status === "failed") },
      { key: "paid", title: "Paid in the last 30 days", rows: admissions.filter((r) => r.status === "paid") },
      {
        key: "extras",
        title: "Optional extras",
        // Read-only on purpose: every write on the panel below moves an
        // application, and an extras order has none. Recording a transfer against
        // one is the next change, not a thing to fake here.
        note: "Stationery, transport, lunch and aftercare a family ordered in the portal. Paid online by the family; not chased.",
        rows: extras,
      },
      {
        key: "transport",
        title: "School transport",
        // Read-only for the same reason as extras: the panel's writes move an
        // application. A transport booking settles from the gateway alone.
        note: "Bookings parents made on the public transport page. Paid online; an unpaid booking expires on its own.",
        rows: transport,
      },
      ];

  const Head = ({ r }: { r: NonNullable<typeof requests>[number] }) => {
    const a = one(r.applications);
    const s = one(r.students);
    const t = one(r.transport_bookings);
    if (r.kind === "transport") {
      // The booking is read under its own policy, so a bursar without
      // `transport.read` sees the row and not who it is for.
      return (
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t ? `${t.parent_first_name} ${t.parent_last_name}` : "School transport booking"}</p>
          <p className="text-xs text-muted-foreground">
            School transport · {t ? `${t.reference} · ${t.status.replace("_", " ")}` : "you cannot see this booking"} · requested {formatDateTime(r.created_at)}
          </p>
        </div>
      );
    }
    if (a) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Link href={`/staff/applications/${a.id}`} className="font-semibold hover:underline">{a.child_first_name} {a.child_last_name}</Link>
            <p className="text-xs text-muted-foreground">{one(a.grades)?.name} · {one(a.campuses)?.name} · {a.reference} · requested {formatDateTime(r.created_at)}</p>
          </div>
          <StatusBadge status={a.status} />
        </div>
      );
    }
    if (s) {
      const name = s.preferred_name || s.legal_first_name;
      return (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{name} {s.legal_last_name}</p>
            <p className="text-xs text-muted-foreground">
              {one(s.grades)?.name} · {one(s.campuses)?.name} · {s.student_code} · ordered {formatDateTime(r.created_at)}
            </p>
          </div>
        </div>
      );
    }
    // A request whose subject has been deleted. Shown rather than hidden: a row
    // carrying money that nobody can attribute is precisely what finance needs
    // to see.
    return (
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Subject no longer on record</p>
        <p className="text-xs text-muted-foreground">Requested {formatDateTime(r.created_at)}</p>
      </div>
    );
  };

  return (
    <>
      <AdmissionsHeader
        ctx={{ permissions }}
        data={header}
        stage="enrolment"
        view="payments"
        description="Registration and admission fees, the optional extras families order in the portal, and school transport. Anything becomes paid only on a verified gateway payment or a bank transfer recorded here."
      />
      {show ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Only what the dashboard counted. <Link href="/staff/payments" className="text-primary underline underline-offset-2">Show all payments</Link>
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h2 className="mb-1 text-sm font-semibold">{g.title} ({g.rows.length})</h2>
          {g.note ? <p className="mb-2 text-xs text-muted-foreground">{g.note}</p> : null}
          {g.rows.length ? (
            <div className="space-y-3">
              {g.rows.map((r) => {
                const a = one(r.applications);
                // Strip the embeds before handing the row to the panel.
                const request = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "applications" && k !== "students" && k !== "transport_bookings"));
                return (
                  <section key={r.id} className="surface p-4">
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
