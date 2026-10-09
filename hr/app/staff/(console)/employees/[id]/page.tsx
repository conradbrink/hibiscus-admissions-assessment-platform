import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { EmployeeFields } from "@/components/employees/employee-fields";
import { Fact, Field, Pill } from "@/components/staff/field";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, isActiveWarning, STATUS_LABEL as CASE_STATUS, WARNING_LABEL } from "@/lib/disciplinary";
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from "@/lib/employees/labels";
import { formatDate } from "@/lib/format-date";
import { balancesFor } from "@/lib/leave/balance";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import {
  acknowledgeWarningAction,
  addContractAction,
  addPayItemAction,
  decideLeaveAction,
  endPayItemAction,
  recordLeaveAction,
  saveBankAction,
  savePrivateAction,
  setCompensationAction,
  setEntitlementAction,
  setStatusAction,
  updateEmployeeAction,
  verifyBankAction,
} from "../actions";

export const metadata = { title: "Employee" };

const LEAVE_TONE = { pending: "warning", approved: "success", declined: "destructive", cancelled: "muted" } as const;
const LEAVE_WORD = { pending: "Waiting", approved: "Approved", declined: "Not approved", cancelled: "Cancelled" } as const;

function Section({ id, title, description, children, action }: { id: string; title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className="surface scroll-mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A form tucked behind a "show" link, so the page reads as a record first and an editor second. */
function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl border border-border open:bg-muted/30">
      <summary className="cursor-pointer list-none rounded-xl px-4 py-2.5 text-sm font-semibold text-primary hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.employees.read");
  const { data: e } = await ctx.supabase.from("hr_employees").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();

  const may = {
    write: can(ctx.permissions, "hr.employees.write"),
    sensitive: can(ctx.permissions, "hr.employees.sensitive.read"),
    pay: can(ctx.permissions, "hr.compensation.read"),
    payWrite: can(ctx.permissions, "hr.compensation.write"),
    leave: can(ctx.permissions, "hr.leave.approve"),
    discipline: can(ctx.permissions, "hr.disciplinary.read"),
    disciplineWrite: can(ctx.permissions, "hr.disciplinary.write"),
  };
  const year = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const none = Promise.resolve({ data: null });

  const [
    campuses,
    { data: departments },
    { data: campus },
    { data: contracts },
    { data: priv },
    { data: comps },
    { data: items },
    { data: catalogue },
    { data: bank },
    { data: leaveTypes },
    { data: leave },
    { data: entitlements },
    { data: cases },
    { data: warnings },
  ] = await Promise.all([
    accessibleCampuses(ctx.supabase),
    ctx.supabase.from("hr_departments").select("id, name").order("name"),
    ctx.supabase.from("campuses").select("name, country, currency").eq("id", e.campus_id).single(),
    ctx.supabase.from("hr_employee_contracts").select("*").eq("employee_id", id).order("starts_on", { ascending: false }),
    may.sensitive ? ctx.supabase.from("hr_employee_private").select("*").eq("employee_id", id).maybeSingle() : none,
    may.pay ? ctx.supabase.from("hr_employee_compensation").select("*").eq("employee_id", id).order("effective_from", { ascending: false }) : none,
    may.pay ? ctx.supabase.from("hr_employee_pay_items").select("*").eq("employee_id", id).order("effective_from", { ascending: false }) : none,
    ctx.supabase.from("hr_pay_items").select("*").eq("is_active", true).order("sort_order"),
    may.pay ? ctx.supabase.from("hr_employee_bank").select("*").eq("employee_id", id).maybeSingle() : none,
    ctx.supabase.from("hr_leave_types").select("*").order("sort_order"),
    ctx.supabase.from("hr_leave_requests").select("*").eq("employee_id", id).order("starts_on", { ascending: false }).limit(50),
    ctx.supabase.from("hr_leave_entitlements").select("*").eq("employee_id", id).eq("year", year),
    may.discipline ? ctx.supabase.from("hr_disciplinary_cases").select("*").eq("employee_id", id).order("opened_at", { ascending: false }) : none,
    may.discipline ? ctx.supabase.from("hr_warnings").select("*").eq("employee_id", id).order("issued_on", { ascending: false }) : none,
  ]);

  const country = (campus?.country ?? "BW") as "BW" | "ZA";
  const currency = campus?.currency ?? "BWP";
  const department = (departments ?? []).find((d) => d.id === e.department_id)?.name;
  const itemLabel = new Map((catalogue ?? []).map((i) => [i.code, i.label]));
  const currentComp = (comps ?? []).find((c) => c.effective_from <= today) ?? null;
  const balances = balancesFor({
    year,
    country,
    employee: e,
    types: leaveTypes ?? [],
    requests: leave ?? [],
    overrides: Object.fromEntries((entitlements ?? []).map((x) => [x.leave_type_code, Number(x.days)])),
  });
  const activeWarnings = (warnings ?? []).filter((w) => isActiveWarning(w, today));

  const sections = [
    ["details", "Details"],
    ["contract", "Contract"],
    may.sensitive ? ["personal", "Personal"] : null,
    may.pay ? ["pay", "Pay"] : null,
    ["leave", "Leave"],
    may.discipline ? ["discipline", "Disciplinary"] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <PageTitle
        title={`${e.first_name} ${e.last_name}`}
        description={`${e.position_title} at ${campus?.name ?? "the school"}. Employee number ${e.employee_number}.`}
        back={{ href: "/staff/employees", label: "Employees" }}
      >
        <Pill tone={STATUS_TONE[e.employment_status]}>{STATUS_LABEL[e.employment_status]}</Pill>
        {activeWarnings.length ? <Pill tone="warning">{activeWarnings.length === 1 ? "1 warning in force" : `${activeWarnings.length} warnings in force`}</Pill> : null}
      </PageTitle>

      <nav aria-label="On this page" className="sticky top-0 z-10 -mx-1 mb-5 flex flex-wrap gap-1 bg-background/90 px-1 py-2 backdrop-blur">
        {sections.map(([href, label]) => (
          <a key={href} href={`#${href}`} className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        {/* ---------------------------------------------------------------- Details */}
        <Section id="details" title="Details">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Position">{e.position_title}</Fact>
            <Fact label="Department">{department}</Fact>
            <Fact label="School">{campus?.name}</Fact>
            <Fact label="Contract">{TYPE_LABEL[e.employment_type]}</Fact>
            <Fact label="Started">{formatDate(e.start_date)}</Fact>
            <Fact label="Probation ends">{e.probation_end_date ? formatDate(e.probation_end_date) : null}</Fact>
            <Fact label="Email">{e.email}</Fact>
            <Fact label="Phone">{e.phone}</Fact>
            {e.end_date ? <Fact label="Last working day">{formatDate(e.end_date)}</Fact> : null}
            {e.termination_reason ? <Fact label="Reason for leaving">{e.termination_reason}</Fact> : null}
            {e.hr_application_id ? (
              <Fact label="Hired through">
                <Link href={`/staff/recruitment/applications/${e.hr_application_id}`} className="font-medium text-primary hover:underline">
                  Their application
                </Link>
              </Fact>
            ) : null}
          </dl>
          {may.write ? (
            <>
              <Disclosure summary="Edit details">
                <ActionForm action={updateEmployeeAction.bind(null, e.id)} label="Save details" resetOnSubmit={false} className="space-y-5 pt-2">
                  <EmployeeFields initial={e} campuses={campuses} departments={departments ?? []} />
                </ActionForm>
              </Disclosure>
              <Disclosure summary="Change status (on leave, suspended, left)">
                <ActionForm
                  action={setStatusAction.bind(null, e.id)}
                  label="Save status"
                  resetOnSubmit={false}
                  className="grid gap-4 pt-2 md:grid-cols-3"
                  confirmBy={{ field: "employment_status", messages: { terminated: `Record that ${e.first_name} has left? They will no longer be paid from the month after their last day.` } }}
                >
                  <Field label="Status" htmlFor="employment_status">
                    <NativeSelect id="employment_status" name="employment_status" defaultValue={e.employment_status}>
                      <option value="active">Working</option>
                      <option value="on_leave">On leave</option>
                      <option value="suspended">Suspended</option>
                      <option value="terminated">Left</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Last working day (if they left)" htmlFor="end_date">
                    <Input id="end_date" name="end_date" type="date" defaultValue={e.end_date ?? ""} />
                  </Field>
                  <Field label="Reason (if they left)" htmlFor="termination_reason">
                    <Input id="termination_reason" name="termination_reason" defaultValue={e.termination_reason ?? ""} placeholder="Resigned" />
                  </Field>
                </ActionForm>
              </Disclosure>
            </>
          ) : null}
        </Section>

        {/* ---------------------------------------------------------------- Contract */}
        <Section id="contract" title="Contract" description="Each new contract or renewal is kept, newest first.">
          {contracts?.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Probation</th>
                    <th>Hours a week</th>
                    <th>Notice</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id}>
                      <td>{TYPE_LABEL[c.contract_type]}</td>
                      <td className="tabular-nums">{formatDate(c.starts_on)}</td>
                      <td className="tabular-nums">{c.ends_on ? formatDate(c.ends_on) : "No end date"}</td>
                      <td>{c.probation_months ? `${c.probation_months} months` : "None"}</td>
                      <td className="tabular-nums">{c.hours_per_week ?? ""}</td>
                      <td>{c.notice_weeks ? `${c.notice_weeks} weeks` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No contract recorded yet.</p>
          )}
          {may.write ? (
            <Disclosure summary="Add a contract or renewal">
              <ActionForm action={addContractAction.bind(null, e.id)} label="Add contract" className="grid gap-4 pt-2 md:grid-cols-3">
                <Field label="Type" htmlFor="contract_type">
                  <NativeSelect id="contract_type" name="contract_type" defaultValue={e.employment_type}>
                    <option value="permanent">Permanent</option>
                    <option value="fixed_term">Fixed term</option>
                    <option value="part_time">Part time</option>
                    <option value="temporary">Temporary</option>
                  </NativeSelect>
                </Field>
                <Field label="Starts" htmlFor="starts_on">
                  <Input id="starts_on" name="starts_on" type="date" required />
                </Field>
                <Field label="Ends (fixed term only)" htmlFor="ends_on">
                  <Input id="ends_on" name="ends_on" type="date" />
                </Field>
                <Field label="Probation (months)" htmlFor="probation_months" hint="Sets the date probation ends.">
                  <Input id="probation_months" name="probation_months" type="number" min={0} max={12} defaultValue={3} />
                </Field>
                <Field label="Hours a week" htmlFor="hours_per_week">
                  <Input id="hours_per_week" name="hours_per_week" type="number" min={0} max={80} step="0.5" defaultValue={40} />
                </Field>
                <Field label="Notice (weeks)" htmlFor="notice_weeks">
                  <Input id="notice_weeks" name="notice_weeks" type="number" min={0} max={26} defaultValue={4} />
                </Field>
                <Field label="Notes (optional)" htmlFor="notes" className="md:col-span-3">
                  <Textarea id="notes" name="notes" rows={2} />
                </Field>
              </ActionForm>
            </Disclosure>
          ) : null}
        </Section>

        {/* ---------------------------------------------------------------- Personal */}
        {may.sensitive ? (
          <Section id="personal" title="Personal details" description="Identity, tax and teaching registration. Only people with the personal details permission can see this.">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="ID number">{priv?.id_number}</Fact>
              <Fact label="Passport">{priv?.passport_number}</Fact>
              <Fact label="Date of birth">{priv?.date_of_birth ? formatDate(priv.date_of_birth) : null}</Fact>
              <Fact label="Nationality">{priv?.nationality}</Fact>
              <Fact label="Tax number">{priv?.tax_number}</Fact>
              <Fact label="Address">{priv?.address}</Fact>
              <Fact label="Next of kin">{priv?.next_of_kin_name ? `${priv.next_of_kin_name}${priv.next_of_kin_phone ? `, ${priv.next_of_kin_phone}` : ""}` : null}</Fact>
              <Fact label="Teacher registration">
                {priv?.registration_body && priv.registration_body !== "none" ? (
                  <>
                    {priv.registration_body} {priv.registration_number}
                    {priv.registration_expires_on ? (
                      <span className={priv.registration_expires_on < today ? "block text-destructive" : "block text-muted-foreground"}>
                        {priv.registration_expires_on < today ? "Expired" : "Until"} {formatDate(priv.registration_expires_on)}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </Fact>
              <Fact label="Work permit">
                {priv?.permit_type ? (
                  <>
                    {priv.permit_type}
                    {priv.permit_expires_on ? (
                      <span className={priv.permit_expires_on < today ? "block text-destructive" : "block text-muted-foreground"}>
                        {priv.permit_expires_on < today ? "Expired" : "Until"} {formatDate(priv.permit_expires_on)}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </Fact>
              <Fact label="Police clearance">{priv?.police_clearance_on ? `Issued ${formatDate(priv.police_clearance_on)}` : null}</Fact>
            </dl>
            {may.write ? (
              <Disclosure summary="Edit personal details">
                <ActionForm action={savePrivateAction.bind(null, e.id)} label="Save personal details" resetOnSubmit={false} className="grid gap-4 pt-2 md:grid-cols-3">
                  {(
                    [
                      ["id_number", "ID number", "text"],
                      ["passport_number", "Passport number", "text"],
                      ["date_of_birth", "Date of birth", "date"],
                      ["nationality", "Nationality", "text"],
                      ["tax_number", "Tax number", "text"],
                      ["next_of_kin_name", "Next of kin", "text"],
                      ["next_of_kin_phone", "Next of kin phone", "tel"],
                      ["registration_number", "Registration number", "text"],
                      ["registration_expires_on", "Registration expires", "date"],
                      ["permit_type", "Work permit type", "text"],
                      ["permit_expires_on", "Permit expires", "date"],
                      ["police_clearance_on", "Police clearance issued", "date"],
                    ] as const
                  ).map(([name, label, type]) => (
                    <Field key={name} label={label} htmlFor={name}>
                      <Input id={name} name={name} type={type} defaultValue={(priv?.[name] as string | null) ?? ""} autoComplete="off" />
                    </Field>
                  ))}
                  <Field label="Registered with" htmlFor="registration_body">
                    <NativeSelect id="registration_body" name="registration_body" defaultValue={priv?.registration_body ?? ""}>
                      <option value="">Not recorded</option>
                      <option value="SACE">SACE (South Africa)</option>
                      <option value="BTPC">BTPC (Botswana)</option>
                      <option value="other">Other</option>
                      <option value="none">Not registered</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Address" htmlFor="address" className="md:col-span-2">
                    <Textarea id="address" name="address" rows={2} defaultValue={priv?.address ?? ""} />
                  </Field>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Section>
        ) : null}

        {/* ---------------------------------------------------------------- Pay */}
        {may.pay ? (
          <Section id="pay" title="Pay" description={`Paid in ${currency === "ZAR" ? "rand" : "pula"}. A pay change starts from a date, so older months keep the pay that was due then.`}>
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Basic pay now</p>
                {currentComp ? (
                  <>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {currentComp.pay_basis === "monthly" ? formatMoney(Number(currentComp.basic_monthly_minor), currency) : `${formatMoney(Number(currentComp.hourly_rate_minor), currency)} an hour`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentComp.pay_basis === "monthly" ? "a month" : `about ${currentComp.normal_hours_per_month} hours a month`}, since {formatDate(currentComp.effective_from)}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Tax: {currentComp.tax_residency === "resident" ? "resident" : "non-resident"}
                      {country === "ZA" ? `, ${currentComp.medical_aid_members} on medical aid` : ""}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No salary set up yet. This person will be left out of payroll until there is one.</p>
                )}
              </div>
              <div className="rounded-xl border border-border p-4 lg:col-span-2">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Allowances and deductions</p>
                {items?.length ? (
                  <ul className="mt-2 divide-y divide-border text-sm">
                    {items.map((it) => {
                      const ended = it.effective_to && it.effective_to < today;
                      return (
                        <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className={ended ? "text-muted-foreground line-through" : undefined}>
                            {itemLabel.get(it.item_code) ?? it.item_code}
                            <span className="block text-xs text-muted-foreground">
                              From {formatDate(it.effective_from)}
                              {it.effective_to ? ` to ${formatDate(it.effective_to)}` : ""}
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="font-medium tabular-nums">{formatMoney(Number(it.amount_minor), currency)}</span>
                            {may.payWrite && !it.effective_to ? (
                              <ActionForm action={endPayItemAction.bind(null, e.id, it.id)} label="Stop" size="xs" variant="outline" className="flex items-center gap-2 space-y-0">
                                <Input name="end_on" type="date" aria-label="Last day it is paid" className="h-7 w-36 text-xs" defaultValue={today} />
                              </ActionForm>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">None.</p>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border p-4">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Bank account</p>
              {bank ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <p>
                    {bank.bank_name}
                    {bank.branch_code ? `, branch ${bank.branch_code}` : ""}, account ending {bank.account_number.slice(-4)} in the name of {bank.account_name}
                  </p>
                  {bank.verified_at ? (
                    <Pill tone="success">Confirmed {formatDate(bank.verified_at)}</Pill>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Pill tone="warning">Not yet confirmed</Pill>
                      {may.payWrite ? <ActionForm action={verifyBankAction.bind(null, e.id)} label="Confirm details" size="xs" variant="outline" /> : null}
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No bank details. The bank file will leave this person blank.</p>
              )}
            </div>

            {may.payWrite ? (
              <>
                <Disclosure summary={currentComp ? "Change pay" : "Set up pay"}>
                  <ActionForm action={setCompensationAction.bind(null, e.id)} label="Save pay" resetOnSubmit={false} className="grid gap-4 pt-2 md:grid-cols-3">
                    <Field label="Starting from" htmlFor="effective_from" hint="The first day the new pay applies.">
                      <Input id="effective_from" name="effective_from" type="date" defaultValue={currentComp ? today : e.start_date} required />
                    </Field>
                    <Field label="Paid" htmlFor="pay_basis">
                      <NativeSelect id="pay_basis" name="pay_basis" defaultValue={currentComp?.pay_basis ?? "monthly"}>
                        <option value="monthly">Monthly salary</option>
                        <option value="hourly">By the hour</option>
                      </NativeSelect>
                    </Field>
                    <Field label="Monthly salary" htmlFor="basic_monthly" hint="For a monthly salary.">
                      <Input id="basic_monthly" name="basic_monthly" inputMode="decimal" defaultValue={currentComp ? String(Number(currentComp.basic_monthly_minor) / 100) : ""} />
                    </Field>
                    <Field label="Hourly rate" htmlFor="hourly_rate" hint="For pay by the hour.">
                      <Input id="hourly_rate" name="hourly_rate" inputMode="decimal" defaultValue={currentComp ? String(Number(currentComp.hourly_rate_minor) / 100) : ""} />
                    </Field>
                    <Field label="Normal hours a month" htmlFor="normal_hours_per_month" hint="Used to work out overtime.">
                      <Input id="normal_hours_per_month" name="normal_hours_per_month" type="number" step="0.01" defaultValue={currentComp?.normal_hours_per_month ?? 173.33} />
                    </Field>
                    <Field label="Tax residence" htmlFor="tax_residency">
                      <NativeSelect id="tax_residency" name="tax_residency" defaultValue={currentComp?.tax_residency ?? "resident"}>
                        <option value="resident">Resident</option>
                        <option value="non_resident">Non-resident</option>
                      </NativeSelect>
                    </Field>
                    {country === "ZA" ? (
                      <Field label="People on medical aid" htmlFor="medical_aid_members" hint="Including the employee. 0 if not on a scheme.">
                        <Input id="medical_aid_members" name="medical_aid_members" type="number" min={0} max={20} defaultValue={currentComp?.medical_aid_members ?? 0} />
                      </Field>
                    ) : (
                      <input type="hidden" name="medical_aid_members" value="0" />
                    )}
                    <Field label="Note (optional)" htmlFor="pay_notes" className="md:col-span-2">
                      <Input id="pay_notes" name="notes" placeholder="Annual increase" />
                    </Field>
                  </ActionForm>
                </Disclosure>
                <Disclosure summary="Add an allowance or deduction">
                  <ActionForm action={addPayItemAction.bind(null, e.id)} label="Add" className="grid gap-4 pt-2 md:grid-cols-4">
                    <Field label="What" htmlFor="item_code">
                      <NativeSelect id="item_code" name="item_code" required>
                        {(catalogue ?? [])
                          .filter((c) => !c.country || c.country === country)
                          .map((c) => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                          ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Amount a month" htmlFor="amount">
                      <Input id="amount" name="amount" inputMode="decimal" required />
                    </Field>
                    <Field label="From" htmlFor="item_from">
                      <Input id="item_from" name="effective_from" type="date" defaultValue={today} required />
                    </Field>
                    <Field label="Until (optional)" htmlFor="item_to">
                      <Input id="item_to" name="effective_to" type="date" />
                    </Field>
                  </ActionForm>
                </Disclosure>
                <Disclosure summary={bank ? "Change bank details" : "Add bank details"}>
                  <ActionForm action={saveBankAction.bind(null, e.id)} label="Save bank details" className="grid gap-4 pt-2 md:grid-cols-2">
                    <p className="text-sm text-muted-foreground md:col-span-2">After you save, someone else must confirm the new details before payday. This protects against a wrong or fraudulent account number.</p>
                    <Field label="Bank" htmlFor="bank_name">
                      <Input id="bank_name" name="bank_name" defaultValue={bank?.bank_name ?? ""} required />
                    </Field>
                    <Field label="Branch code (optional)" htmlFor="branch_code">
                      <Input id="branch_code" name="branch_code" defaultValue={bank?.branch_code ?? ""} />
                    </Field>
                    <Field label="Name on the account" htmlFor="account_name">
                      <Input id="account_name" name="account_name" defaultValue={bank?.account_name ?? `${e.first_name} ${e.last_name}`} required />
                    </Field>
                    <Field label="Account number" htmlFor="account_number">
                      <Input id="account_number" name="account_number" inputMode="numeric" autoComplete="off" required />
                    </Field>
                  </ActionForm>
                </Disclosure>
              </>
            ) : null}
          </Section>
        ) : null}

        {/* ---------------------------------------------------------------- Leave */}
        <Section id="leave" title={`Leave in ${year}`} description="Days left are worked out from this year's allowance and the leave already approved.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <div key={b.code} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold">{b.name}</p>
                {b.remainingDays !== null ? (
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {b.remainingDays}
                    <span className="text-sm font-normal text-muted-foreground"> of {b.entitledDays} {b.entitledDays === 1 ? "day" : "days"} left</span>
                  </p>
                ) : (
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {b.takenDays}
                    <span className="text-sm font-normal text-muted-foreground"> {b.takenDays === 1 ? "day" : "days"} taken</span>
                  </p>
                )}
                {b.pendingDays ? <p className="text-xs text-warning-foreground">{b.pendingDays} {b.pendingDays === 1 ? "day" : "days"} waiting for a decision</p> : null}
              </div>
            ))}
          </div>

          {leave?.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Dates</th>
                    <th className="text-right">Days</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leave.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {(leaveTypes ?? []).find((t) => t.code === r.leave_type_code)?.name ?? r.leave_type_code}
                        {r.reason ? <span className="block text-xs text-muted-foreground">{r.reason}</span> : null}
                      </td>
                      <td className="tabular-nums">
                        {formatDate(r.starts_on)}
                        {r.ends_on !== r.starts_on ? ` to ${formatDate(r.ends_on)}` : ""}
                      </td>
                      <td className="text-right tabular-nums">{r.days}</td>
                      <td>
                        <Pill tone={LEAVE_TONE[r.status]}>{LEAVE_WORD[r.status]}</Pill>
                      </td>
                      <td className="text-right">
                        {may.leave && r.status === "pending" ? (
                          <div className="flex justify-end gap-1.5">
                            <ActionForm action={decideLeaveAction.bind(null, r.id)} label="Approve" size="xs" className="space-y-0">
                              <input type="hidden" name="decision" value="approved" />
                              <input type="hidden" name="notify" value="on" />
                            </ActionForm>
                            <ActionForm action={decideLeaveAction.bind(null, r.id)} label="Decline" size="xs" variant="outline" className="space-y-0">
                              <input type="hidden" name="decision" value="declined" />
                              <input type="hidden" name="notify" value="on" />
                            </ActionForm>
                          </div>
                        ) : may.leave && r.status === "approved" && r.starts_on > today ? (
                          <ActionForm action={decideLeaveAction.bind(null, r.id)} label="Cancel" size="xs" variant="ghost" className="space-y-0" confirm="Cancel this leave? The days go back to the balance.">
                            <input type="hidden" name="decision" value="cancelled" />
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No leave recorded.</p>
          )}

          {may.leave ? (
            <>
              <Disclosure summary="Record leave">
                <ActionForm action={recordLeaveAction} label="Record leave" className="grid gap-4 pt-2 md:grid-cols-4">
                  <input type="hidden" name="employee_id" value={e.id} />
                  <Field label="Type" htmlFor="leave_type_code">
                    <NativeSelect id="leave_type_code" name="leave_type_code">
                      {balances.map((b) => (
                        <option key={b.code} value={b.code}>{b.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="First day" htmlFor="leave_from">
                    <Input id="leave_from" name="starts_on" type="date" required />
                  </Field>
                  <Field label="Last day" htmlFor="leave_to">
                    <Input id="leave_to" name="ends_on" type="date" required />
                  </Field>
                  <Field label="Working days" htmlFor="leave_days" hint="Leave out weekends and public holidays.">
                    <Input id="leave_days" name="days" type="number" min={0.5} step={0.5} required />
                  </Field>
                  <Field label="Reason (optional)" htmlFor="leave_reason" className="md:col-span-3">
                    <Input id="leave_reason" name="reason" />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" name="approve_now" defaultChecked className="size-4 accent-primary" />
                    Already approved
                  </label>
                </ActionForm>
              </Disclosure>
              <Disclosure summary={`Change this year's allowance`}>
                <ActionForm action={setEntitlementAction.bind(null, e.id)} label="Save allowance" className="grid gap-4 pt-2 md:grid-cols-3">
                  <input type="hidden" name="year" value={year} />
                  <Field label="Type" htmlFor="ent_code">
                    <NativeSelect id="ent_code" name="code">
                      {balances.map((b) => (
                        <option key={b.code} value={b.code}>{b.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Days this year" htmlFor="ent_days" hint="Leave empty to go back to the normal allowance.">
                    <Input id="ent_days" name="days" type="number" min={0} step={0.5} />
                  </Field>
                </ActionForm>
              </Disclosure>
            </>
          ) : null}
        </Section>

        {/* ---------------------------------------------------------------- Disciplinary */}
        {may.discipline ? (
          <Section
            id="discipline"
            title="Disciplinary"
            description="Cases and warnings. A warning stops counting on its end date, but stays on the record."
            action={
              may.disciplineWrite ? (
                <Link href={`/staff/disciplinary/new?employee=${e.id}`} className="text-sm font-semibold text-primary hover:underline">
                  Open a case
                </Link>
              ) : null
            }
          >
            {warnings?.length ? (
              <ul className="mb-4 divide-y divide-border rounded-xl border border-border">
                {warnings.map((w) => {
                  const active = isActiveWarning(w, today);
                  return (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span>
                        <span className="font-semibold">{WARNING_LABEL[w.level]}:</span> {w.reason}
                        <span className="block text-xs text-muted-foreground">
                          Given {formatDate(w.issued_on)}, {active ? "counts until" : "stopped counting on"} {formatDate(w.expires_on)}
                          {w.acknowledged_at ? `. Signed by the employee ${formatDate(w.acknowledged_at)}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Pill tone={active ? "warning" : "muted"}>{active ? "In force" : "Expired"}</Pill>
                        {may.disciplineWrite && !w.acknowledged_at ? (
                          <ActionForm action={acknowledgeWarningAction.bind(null, e.id, w.id)} label="Mark as signed" size="xs" variant="outline" className="space-y-0" />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {cases?.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link href={`/staff/disciplinary/cases/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm hover:bg-muted/50">
                      <span>
                        <span className="font-semibold">{c.summary}</span>
                        <span className="block text-xs text-muted-foreground">
                          {CATEGORY_LABEL[c.category]}, opened {formatDate(c.opened_at)}
                        </span>
                      </span>
                      <Pill tone={c.status === "closed" ? "muted" : "info"}>{CASE_STATUS[c.status]}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No cases.</p>
            )}
          </Section>
        ) : null}
      </div>
    </>
  );
}
