import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { Field, Pill } from "@/components/staff/field";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, OUTCOME_LABEL, STATUS_LABEL, WARNING_LABEL, WARNING_MONTHS } from "@/lib/disciplinary";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { CaseEventKind } from "@/lib/supabase/types";
import { addEventAction, closeCaseAction, outcomeAction } from "../../actions";

export const metadata = { title: "Case" };

const EVENT_LABEL: Record<CaseEventKind, string> = {
  note: "Note",
  evidence: "Evidence",
  hearing_scheduled: "Hearing booked",
  hearing_held: "Hearing held",
  outcome: "Outcome",
  appeal: "Appeal",
  closed: "Closed",
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.disciplinary.read");
  const { data: c } = await ctx.supabase.from("hr_disciplinary_cases").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: e }, { data: events }, { data: warnings }] = await Promise.all([
    ctx.supabase.from("hr_employees").select("id, first_name, last_name, position_title").eq("id", c.employee_id).single(),
    ctx.supabase.from("hr_case_events").select("*").eq("case_id", c.id).order("id"),
    ctx.supabase.from("hr_warnings").select("*").eq("case_id", c.id),
  ]);
  const authors = [...new Set((events ?? []).map((ev) => ev.created_by).filter(Boolean))] as string[];
  const { data: staff } = authors.length ? await ctx.supabase.from("staff_profiles").select("id, full_name").in("id", authors) : { data: [] };
  const nameOf = (sid: string | null) => (staff ?? []).find((s) => s.id === sid)?.full_name ?? "";
  const write = can(ctx.permissions, "hr.disciplinary.write");
  const open = c.status !== "closed";
  const today = new Date().toISOString().slice(0, 10);
  const name = e ? `${e.first_name} ${e.last_name}` : "Employee";

  return (
    <>
      <PageTitle title={c.summary} description={`${CATEGORY_LABEL[c.category]} case for ${name}, opened ${formatDate(c.opened_at)}.`} back={{ href: "/staff/disciplinary", label: "Disciplinary" }}>
        <Pill tone={open ? "info" : "muted"}>{STATUS_LABEL[c.status]}</Pill>
      </PageTitle>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {c.details ? (
            <section className="surface p-5">
              <h2 className="mb-2 font-semibold">What happened</h2>
              <p className="text-sm whitespace-pre-wrap">{c.details}</p>
            </section>
          ) : null}

          <section className="surface p-5">
            <h2 className="mb-1 font-semibold">Case record</h2>
            <p className="mb-4 text-sm text-muted-foreground">Entries are kept in order and cannot be edited. To correct something, add a note.</p>
            <ol className="space-y-4">
              {(events ?? []).map((ev) => (
                <li key={ev.id} className="relative border-l-2 border-border pl-4">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{EVENT_LABEL[ev.kind]}</span> · {formatDateTime(ev.created_at)}
                    {nameOf(ev.created_by) ? ` · ${nameOf(ev.created_by)}` : ""}
                  </p>
                  {ev.occurs_at ? <p className="text-xs font-semibold text-info">On {formatDateTime(ev.occurs_at)}</p> : null}
                  <p className="mt-1 text-sm whitespace-pre-wrap">{ev.body}</p>
                </li>
              ))}
            </ol>
            {write ? (
              <ActionForm action={addEventAction.bind(null, c.id)} label="Add to the record" className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
                <Field label="What is this" htmlFor="kind">
                  <NativeSelect id="kind" name="kind" defaultValue="note">
                    <option value="note">A note</option>
                    {open ? (
                      <>
                        <option value="evidence">Evidence or a statement</option>
                        <option value="hearing_scheduled">A hearing has been booked</option>
                        <option value="hearing_held">The hearing took place</option>
                        <option value="appeal">The employee has appealed</option>
                      </>
                    ) : null}
                  </NativeSelect>
                </Field>
                <Field label="Date and time (for a hearing)" htmlFor="occurs_at">
                  <Input id="occurs_at" name="occurs_at" type="datetime-local" />
                </Field>
                <Field label="Details" htmlFor="body" className="md:col-span-2">
                  <Textarea id="body" name="body" rows={4} required />
                </Field>
              </ActionForm>
            ) : null}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="surface p-5 text-sm">
            <h2 className="mb-2 font-semibold">Employee</h2>
            {e ? (
              <Link href={`/staff/employees/${e.id}#discipline`} className="font-semibold text-primary hover:underline">
                {name}
              </Link>
            ) : null}
            <p className="text-muted-foreground">{e?.position_title}</p>
          </section>

          <section className="surface p-5 text-sm">
            <h2 className="mb-2 font-semibold">Outcome</h2>
            {c.outcome ? (
              <>
                <p className="font-semibold">{OUTCOME_LABEL[c.outcome]}</p>
                {c.outcome_note ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.outcome_note}</p> : null}
                {(warnings ?? []).map((w) => (
                  <p key={w.id} className="mt-2">
                    {WARNING_LABEL[w.level]} {w.expires_on >= today ? "counts until" : "stopped counting on"} {formatDate(w.expires_on)}.
                  </p>
                ))}
              </>
            ) : (
              <p className="text-muted-foreground">No outcome yet. Give the outcome after the hearing.</p>
            )}
            {write && open && !c.outcome ? (
              <ActionForm action={outcomeAction.bind(null, c.id)} label="Record outcome" className="mt-4 space-y-3" confirm="Record this outcome? It is added to the record and cannot be edited.">
                <Field label="Outcome" htmlFor="outcome" hint={`Warnings count for ${WARNING_MONTHS.verbal} months (verbal and written) or ${WARNING_MONTHS.final_written} months (final written), unless you choose another end date.`}>
                  <NativeSelect id="outcome" name="outcome" defaultValue="no_action">
                    {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Reason" htmlFor="outcome_note">
                  <Textarea id="outcome_note" name="outcome_note" rows={3} required />
                </Field>
                <Field label="Date given" htmlFor="issued_on">
                  <Input id="issued_on" name="issued_on" type="date" defaultValue={today} required />
                </Field>
                <Field label="Warning ends (optional)" htmlFor="expires_on">
                  <Input id="expires_on" name="expires_on" type="date" />
                </Field>
              </ActionForm>
            ) : null}
          </section>

          {write && open ? (
            <section className="surface p-5 text-sm">
              <h2 className="mb-2 font-semibold">Close the case</h2>
              <ActionForm action={closeCaseAction.bind(null, c.id)} label="Close case" variant="outline" className="space-y-3" confirm="Close this case? You can still add notes afterwards.">
                <Textarea name="note" rows={2} placeholder="Why it is closed (optional)" aria-label="Why the case is closed" />
              </ActionForm>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
