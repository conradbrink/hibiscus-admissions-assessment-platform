import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Check, Download, FileText, Mail } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { Pill } from "@/components/staff/field";
import { PageTitle } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HrError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { periodBounds, periodLabel } from "@/lib/payroll/period";
import { loadRunPayslips } from "@/lib/payroll/payslips";
import { readTotals } from "@/lib/payroll/run";
import { taxTableFor } from "@/lib/payroll/tax-years";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { approveRunAction, calculateRunAction, deleteRunAction, emailPayslipsAction, lockRunAction, overrideAction } from "../../actions";

export const metadata = { title: "Payroll run" };

const STEPS = ["Timesheet", "Work out pay", "Approve", "Pay and lock"] as const;

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.payroll.read");
  const loaded = await loadRunPayslips(ctx.supabase, id);
  if (!loaded) notFound();
  const { run, slips } = loaded;
  const totals = readTotals(run);
  const editable = run.status === "draft" || run.status === "calculated";
  const may = {
    prepare: can(ctx.permissions, "hr.payroll.prepare"),
    approve: can(ctx.permissions, "hr.payroll.approve"),
    export: can(ctx.permissions, "hr.export"),
  };

  // Why a run cannot be worked out yet, said before anyone presses the button.
  let blocker: string | null = null;
  if (editable) {
    try {
      await taxTableFor(ctx.supabase, run.country, periodBounds(run.period).end);
    } catch (e) {
      if (e instanceof HrError) blocker = e.message;
      else throw e;
    }
  }

  const people = [run.prepared_by, run.approved_by, run.locked_by].filter(Boolean) as string[];
  const { data: staff } = people.length ? await ctx.supabase.from("staff_profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = (sid: string | null) => (sid ? (staff ?? []).find((s) => s.id === sid)?.full_name ?? "a colleague" : "");
  const preparedByMe = run.prepared_by === ctx.userId;
  // When payslips were last emailed. The audit log is read for this one fact
  // under the service role: a payroll officer need not hold the audit permission.
  const { data: emailed } = await createAdminClient()
    .from("hr_audit_log")
    .select("occurred_at")
    .eq("entity_id", run.id)
    .eq("action", "payslip_emails_queued")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const step = run.status === "draft" ? 1 : run.status === "calculated" ? 2 : run.status === "approved" ? 3 : 4;
  const money = (n: number) => formatMoney(n, run.currency);

  return (
    <>
      <PageTitle title={`${periodLabel(run.period)} payroll`} description={`${loaded.campus.name}. Tax worked out with the ${loaded.taxTableCode ?? run.country} tables.`} back={{ href: "/staff/payroll", label: "Payroll" }}>
        <Pill tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Pill>
      </PageTitle>

      <ol className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Steps">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", done ? "border-primary/30 bg-accent text-accent-foreground" : current ? "border-navy/40 bg-card font-semibold" : "border-border text-muted-foreground")}>
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {blocker ? (
        <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
          <p>
            {blocker}{" "}
            {can(ctx.permissions, "hr.tax_tables.write") ? (
              <Link href="/staff/payroll/tax-years" className="font-semibold text-primary hover:underline">
                Open the tax tables
              </Link>
            ) : null}
          </p>
        </div>
      ) : null}

      {totals && editable && !totals.timesheetApproved ? (
        <p className="mb-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          The timesheet for this month is not approved yet. Pay is worked out from the hours entered so far.{" "}
          <Link href={`/staff/timesheets?campus=${run.campus_id}&period=${run.period}`} className="font-semibold text-primary hover:underline">
            Open the timesheet
          </Link>
        </p>
      ) : null}

      {totals?.skipped.length ? (
        <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <p className="font-semibold">{totals.skipped.length === 1 ? "1 person is not in this run" : `${totals.skipped.length} people are not in this run`}</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {totals.skipped.map((s) => (
              <li key={s.employeeId}>
                <Link href={`/staff/employees/${s.employeeId}#pay`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {s.name}
                </Link>
                : {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {totals ? (
        <dl className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["People paid", String(totals.employees)],
              ["Gross pay", money(totals.grossMinor)],
              ["Income tax (PAYE)", money(totals.payeMinor)],
              ["Net pay", money(totals.netMinor)],
              ["Cost to the school", money(totals.employerCostMinor)],
              ...(run.country === "ZA"
                ? ([
                    ["UIF (staff and school)", money(totals.uifEmployeeMinor + totals.uifEmployerMinor)],
                    ["Skills levy (SDL)", money(totals.sdlMinor)],
                  ] as const)
                : []),
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="surface px-4 py-3">
              <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="surface mb-6 flex flex-wrap items-center gap-3 p-4">
        {editable && may.prepare ? <ActionForm action={calculateRunAction.bind(null, run.id)} label={run.status === "draft" ? "Work out pay" : "Work out again"} variant={run.status === "draft" ? "default" : "outline"} /> : null}
        {run.status === "calculated" && may.approve ? (
          preparedByMe ? (
            <p className="text-sm text-muted-foreground">You worked out this run, so someone else must approve it.</p>
          ) : (
            <ActionForm action={approveRunAction.bind(null, run.id)} label="Approve payroll" confirm={`Approve ${periodLabel(run.period)} payroll for ${loaded.campus.name}? After this, nothing in it can change.`} />
          )
        ) : null}
        {run.status === "approved" && may.approve ? <ActionForm action={lockRunAction.bind(null, run.id)} label="Mark as paid and lock" variant="outline" confirm="Lock this run? Do this once the bank has paid everyone." /> : null}
        {slips.length ? (
          <a href={`/staff/payroll/runs/${run.id}/payslips`} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline" }))}>
            <FileText aria-hidden /> Print all payslips
          </a>
        ) : null}
        {(run.status === "approved" || run.status === "locked") && may.approve ? (
          <ActionForm action={emailPayslipsAction.bind(null, run.id)} label={emailed ? "Email payslips again" : "Email payslips"} variant="outline" confirm="Email each person a link to their payslip? People without an email address are skipped." />
        ) : null}
        {(run.status === "approved" || run.status === "locked") && may.export ? (
          <span className="flex flex-wrap items-center gap-2">
            {(
              [
                ["bank", "Bank file"],
                ["journal", "Journal"],
                ["tax", run.country === "ZA" ? "EMP201 figures" : "PAYE return"],
              ] as const
            ).map(([kind, label]) => (
              <a key={kind} href={`/staff/payroll/runs/${run.id}/export/${kind}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                <Download aria-hidden /> {label}
              </a>
            ))}
          </span>
        ) : null}
        {editable && may.prepare ? (
          <ActionForm action={deleteRunAction.bind(null, run.id)} label="Delete run" variant="ghost" size="sm" className="ml-auto" confirm="Delete this run and its payslips? You can start it again." />
        ) : null}
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {run.prepared_at ? `Worked out by ${nameOf(run.prepared_by)}, ${formatDateTime(run.prepared_at)}. ` : ""}
        {run.approved_at ? `Approved by ${nameOf(run.approved_by)}, ${formatDateTime(run.approved_at)}. ` : ""}
        {run.locked_at ? `Locked by ${nameOf(run.locked_by)}, ${formatDateTime(run.locked_at)}. ` : ""}
        {emailed ? (
          <span className="inline-flex items-center gap-1">
            <Mail className="size-3.5" aria-hidden /> Payslips emailed {formatDateTime(emailed.occurred_at)}.
          </span>
        ) : null}
      </p>

      {slips.length ? (
        <div aria-hidden className="hidden grid-cols-[2fr_repeat(4,1fr)_auto] gap-x-4 px-4 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:grid">
          <span>Employee</span>
          <span>Gross</span>
          <span>PAYE</span>
          <span>Other deductions</span>
          <span>Net pay</span>
          <span className="w-24" />
        </div>
      ) : null}
      {slips.length ? (
        <ul className="space-y-2">
          {slips.map((s) => {
            const otherDeductions = Number(s.deductions_minor) - Number(s.paye_minor);
            return (
              <li key={s.id}>
                <details className="group surface overflow-hidden">
                  <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:grid-cols-[2fr_repeat(4,1fr)_auto] [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="font-semibold">{s.snapshot.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {s.snapshot.employee_number} · {s.snapshot.position}
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums sm:text-left">
                      <span className="block text-[11px] text-muted-foreground uppercase sm:hidden">Gross</span>
                      {money(Number(s.gross_minor))}
                    </span>
                    <span className="text-sm tabular-nums">
                      <span className="block text-[11px] text-muted-foreground uppercase sm:hidden">PAYE</span>
                      {money(Number(s.paye_minor))}
                    </span>
                    <span className="text-sm tabular-nums">
                      <span className="block text-[11px] text-muted-foreground uppercase sm:hidden">Other deductions</span>
                      {money(otherDeductions)}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums sm:text-left">
                      <span className="block text-[11px] font-normal text-muted-foreground uppercase sm:hidden">Net</span>
                      {money(Number(s.net_minor))}
                    </span>
                    <span className="flex justify-end gap-1 sm:w-24">
                      {s.lines.some((l) => l.override_reason) ? <Pill tone="info">Adjusted</Pill> : null}
                      {s.warnings.length ? <Pill tone="warning">{s.warnings.length === 1 ? "1 note" : `${s.warnings.length} notes`}</Pill> : null}
                    </span>
                  </summary>
                  <div className="border-t border-border px-4 py-4">
                    {s.warnings.length ? (
                      <ul className="mb-3 space-y-1 text-sm text-warning-foreground">
                        {s.warnings.map((w, i) => (
                          <li key={i} className="flex gap-2">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th className="text-right">Worked out</th>
                          <th className="text-right">Paid</th>
                          {editable && may.prepare ? <th>Change this line</th> : <th>Reason for change</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map((l) => (
                          <tr key={l.id}>
                            <td>
                              {l.label}
                              <span className="block text-xs text-muted-foreground">{l.kind === "earning" ? "Pay" : l.kind === "employer" ? "Paid by the school" : "Deduction"}</span>
                            </td>
                            <td className="text-right tabular-nums">{money(Number(l.computed_minor))}</td>
                            <td className={cn("text-right tabular-nums", l.override_reason && "font-semibold text-info")}>{money(Number(l.effective_minor))}</td>
                            <td>
                              {editable && may.prepare ? (
                                <ActionForm action={overrideAction.bind(null, run.id, s.employee_id, l.code)} label={l.override_reason ? "Update" : "Change"} size="xs" variant="outline" className="flex flex-wrap items-center gap-2 space-y-0">
                                  <Input name="amount" inputMode="decimal" aria-label={`New amount for ${l.label}`} placeholder="Amount" defaultValue={l.override_reason ? String(Number(l.effective_minor) / 100) : ""} className="h-7 w-24 text-xs" />
                                  <Input name="reason" aria-label="Reason" placeholder="Reason" defaultValue={l.override_reason ?? ""} className="h-7 w-48 text-xs" />
                                </ActionForm>
                              ) : (
                                <span className="text-sm text-muted-foreground">{l.override_reason ?? ""}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && may.prepare ? <p className="mt-2 text-xs text-muted-foreground">To undo a change, clear the amount and press Update. Every change is kept in the audit log with its reason.</p> : null}
                    <div className="mt-3 flex gap-4 text-sm">
                      <a href={`/staff/payroll/runs/${run.id}/payslips?employee=${s.employee_id}`} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
                        Open this payslip
                      </a>
                      <Link href={`/staff/employees/${s.employee_id}#pay`} className="font-semibold text-primary hover:underline">
                        Their pay settings
                      </Link>
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : run.status !== "draft" ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nobody at this school has pay set up for this month.</p>
      ) : null}
    </>
  );
}
