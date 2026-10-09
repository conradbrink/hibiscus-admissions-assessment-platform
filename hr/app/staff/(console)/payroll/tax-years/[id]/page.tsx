import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { Field, Pill } from "@/components/staff/field";
import { PageTitle } from "@/components/staff/page-title";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { formatBracketText } from "@/lib/payroll/bracket-text";
import type { Bracket } from "@/lib/payroll/tax-table";
import { requireStaff } from "@/lib/staff/session";
import { publishTaxYearAction, retireTaxYearAction, saveTaxDraftAction } from "../../actions";

export const metadata = { title: "Tax table" };

function BracketTable({ rows, title, currency }: { rows: Bracket[]; title: string; currency: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Yearly income from</th>
            <th>to</th>
            <th className="text-right">Tax</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => a.lowerMinor - b.lowerMinor).map((b) => (
            <tr key={b.lowerMinor}>
              <td className="tabular-nums">{formatMoney(b.lowerMinor, currency)}</td>
              <td className="tabular-nums">{b.upperMinor === null ? "and above" : formatMoney(b.upperMinor, currency)}</td>
              <td className="text-right tabular-nums">
                {b.baseTaxMinor ? `${formatMoney(b.baseTaxMinor, currency)} + ` : ""}
                {Math.round(b.rate * 10000) / 100}% of the amount above {formatMoney(b.lowerMinor, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TaxYearPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.tax_tables.write");
  const [{ data: year }, { data: brackets }] = await Promise.all([
    ctx.supabase.from("hr_tax_years").select("*").eq("id", id).maybeSingle(),
    ctx.supabase.from("hr_tax_brackets").select("*").eq("tax_year_id", id),
  ]);
  if (!year) notFound();
  const currency = year.country === "ZA" ? "ZAR" : "BWP";
  const toBracket = (b: NonNullable<typeof brackets>[number]) => ({ lowerMinor: Number(b.lower_minor), upperMinor: b.upper_minor === null ? null : Number(b.upper_minor), baseTaxMinor: Number(b.base_tax_minor), rate: Number(b.rate) });
  const resident = (brackets ?? []).filter((b) => b.residency === "resident").map(toBracket);
  const nonResident = (brackets ?? []).filter((b) => b.residency === "non_resident").map(toBracket);
  const draft = year.status === "draft";
  const authority = year.country === "ZA" ? "SARS" : "BURS";

  return (
    <>
      <PageTitle
        title={year.code}
        description={`${year.country === "ZA" ? "South Africa" : "Botswana"}, ${formatDate(year.starts_on)} to ${formatDate(year.ends_on)}.`}
        back={{ href: "/staff/payroll/tax-years", label: "Tax tables" }}
      >
        <Pill tone={draft ? "warning" : year.status === "published" ? "success" : "muted"}>{draft ? "Draft" : year.status === "published" ? "In use" : "Retired"}</Pill>
      </PageTitle>

      {year.source_note ? (
        <div className="surface mb-5 p-5 text-sm">
          <h2 className="mb-1 font-semibold">Where these figures come from</h2>
          <p className="max-w-3xl text-muted-foreground">{year.source_note}</p>
        </div>
      ) : null}

      <div className="surface mb-5 grid gap-6 p-5 lg:grid-cols-2">
        <BracketTable rows={resident} title="Residents" currency={currency} />
        <BracketTable rows={nonResident} title="Non-residents" currency={currency} />
      </div>

      {draft ? (
        <>
          <div className="surface mb-5 p-5">
            <h2 className="text-lg font-semibold">Check and correct</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Compare each line with the official {authority} table. One bracket per line: from, to, tax on the &quot;from&quot; amount, and the rate. Leave &quot;to&quot; empty on the top line. Amounts are yearly and in whole {year.country === "ZA" ? "rand" : "pula"}.
            </p>
            <ActionForm action={saveTaxDraftAction.bind(null, year.id)} label="Save corrections" resetOnSubmit={false} className="mt-4 grid gap-4 lg:grid-cols-2">
              <Field label="Resident brackets" htmlFor="resident">
                <Textarea id="resident" name="resident" rows={8} defaultValue={formatBracketText(resident)} className="font-mono text-sm" />
              </Field>
              <Field label="Non-resident brackets" htmlFor="non_resident">
                <Textarea id="non_resident" name="non_resident" rows={8} defaultValue={formatBracketText(nonResident)} className="font-mono text-sm" />
              </Field>
              <Field
                label="Other figures"
                htmlFor="parameters"
                className="lg:col-span-2"
                hint={year.country === "ZA" ? "Rebates, medical tax credits, UIF and SDL, in cents. For example 1782000 is R17,820." : "The pension limit as a share of pay, for example 0.15 for 15%."}
              >
                <Textarea id="parameters" name="parameters" rows={8} defaultValue={JSON.stringify(year.parameters, null, 2)} className="font-mono text-sm" />
              </Field>
              <Field label="Note on the source" htmlFor="source_note" className="lg:col-span-2">
                <Textarea id="source_note" name="source_note" rows={3} defaultValue={year.source_note ?? ""} />
              </Field>
            </ActionForm>
          </div>
          <div className="surface flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="max-w-2xl text-sm">Once published, this table cannot be changed. If a figure is wrong later, add a corrected table and retire this one.</p>
            <ActionForm action={publishTaxYearAction.bind(null, year.id)} label="Publish this table" confirm={`Have you checked every figure in ${year.code} against the official ${authority} table?`} />
          </div>
        </>
      ) : year.status === "published" ? (
        <div className="surface flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
          <p>Published {year.published_at ? formatDateTime(year.published_at) : ""}. Payroll uses it for months in this tax year.</p>
          <ActionForm action={retireTaxYearAction.bind(null, year.id)} label="Retire" variant="ghost" size="sm" confirm="Retire this table? Payroll for these months will stop until another table is published." />
        </div>
      ) : null}
    </>
  );
}
