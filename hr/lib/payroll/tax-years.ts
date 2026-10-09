import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { parseTaxTable, TaxTableError, type TaxTable } from "@/lib/payroll/tax-table";
import { parseBracketText } from "@/lib/payroll/bracket-text";

/**
 * Tax years as data. A year is seeded as a draft from the published tables;
 * a payroll officer checks every figure against SARS or BURS, corrects the
 * draft if needed and publishes it. Payroll refuses a draft, and the
 * database refuses any change to a published year.
 */

type Client = Pick<AdminClient, "from">;

/** The table covering a day, if one is published. A draft covering it is named in the error. */
export async function taxTableFor(client: Client, country: "BW" | "ZA", onIso: string): Promise<{ id: string; table: TaxTable }> {
  const { data: years, error } = await client
    .from("hr_tax_years")
    .select("*")
    .eq("country", country)
    .lte("starts_on", onIso)
    .gte("ends_on", onIso)
    .neq("status", "retired");
  if (error) throw new Error(error.message);
  const published = (years ?? []).find((y) => y.status === "published");
  if (!published) {
    const draft = (years ?? [])[0];
    throw new HrError(
      draft
        ? `The ${draft.code} tax table is still a draft. A payroll officer must check it against the ${country === "ZA" ? "SARS" : "BURS"} tables and publish it under Payroll, Tax tables.`
        : `There is no ${country === "ZA" ? "South African" : "Botswana"} tax table for ${onIso.slice(0, 7)}. Add one under Payroll, Tax tables.`
    );
  }
  return { id: published.id, table: await loadTable(client, published.id) };
}

export async function loadTable(client: Client, taxYearId: string): Promise<TaxTable> {
  const [{ data: year }, { data: brackets }] = await Promise.all([
    client.from("hr_tax_years").select("*").eq("id", taxYearId).single(),
    client.from("hr_tax_brackets").select("*").eq("tax_year_id", taxYearId),
  ]);
  if (!year) throw new Error("Tax year not found");
  return parseTaxTable({ ...year, brackets: brackets ?? [] });
}

/** Replaces a draft year's brackets and parameters from what the officer typed. */
export async function saveDraft(
  admin: AdminClient,
  actor: Actor,
  taxYearId: string,
  input: { resident: string; nonResident: string; parameters: string; sourceNote: string | null }
): Promise<void> {
  const { data: year } = await admin.from("hr_tax_years").select("*").eq("id", taxYearId).single();
  if (!year) throw new HrError("Tax year not found.");
  if (year.status !== "draft") throw new HrError("A published tax year cannot change. Add a new one instead.");

  let parameters: unknown;
  try {
    parameters = JSON.parse(input.parameters);
  } catch {
    throw new HrError("The parameters are not valid JSON.");
  }
  const resident = parseBracketText(input.resident);
  const nonResident = parseBracketText(input.nonResident);
  if ("error" in resident) throw new HrError(`Resident brackets: ${resident.error}`);
  if ("error" in nonResident) throw new HrError(`Non-resident brackets: ${nonResident.error}`);

  // Validate the whole table before writing any of it.
  try {
    parseTaxTable({
      ...year,
      parameters,
      brackets: [
        ...resident.brackets.map((b) => ({ residency: "resident", lower_minor: b.lowerMinor, upper_minor: b.upperMinor, base_tax_minor: b.baseTaxMinor, rate: b.rate })),
        ...nonResident.brackets.map((b) => ({ residency: "non_resident", lower_minor: b.lowerMinor, upper_minor: b.upperMinor, base_tax_minor: b.baseTaxMinor, rate: b.rate })),
      ],
    });
  } catch (e) {
    if (e instanceof TaxTableError) throw new HrError(e.message);
    throw e;
  }

  const { error: delError } = await admin.from("hr_tax_brackets").delete().eq("tax_year_id", taxYearId);
  if (delError) throw new Error(delError.message);
  const rows = [
    ...resident.brackets.map((b) => ({ ...b, residency: "resident" as const })),
    ...nonResident.brackets.map((b) => ({ ...b, residency: "non_resident" as const })),
  ].map((b) => ({ tax_year_id: taxYearId, residency: b.residency, lower_minor: b.lowerMinor, upper_minor: b.upperMinor, base_tax_minor: b.baseTaxMinor, rate: b.rate }));
  const { error: insError } = await admin.from("hr_tax_brackets").insert(rows);
  if (insError) throw new Error(insError.message);
  const { error: upError } = await admin
    .from("hr_tax_years")
    .update({ parameters: parameters as Json, source_note: input.sourceNote })
    .eq("id", taxYearId);
  if (upError) throw new Error(upError.message);
  await audit(admin, actor, { action: "tax_year_draft_saved", entityType: "hr_tax_year", entityId: taxYearId, after: { code: year.code } });
}

export async function publishTaxYear(admin: AdminClient, actor: Actor, taxYearId: string): Promise<void> {
  const { data: year } = await admin.from("hr_tax_years").select("*").eq("id", taxYearId).single();
  if (!year) throw new HrError("Tax year not found.");
  if (year.status !== "draft") throw new HrError("This tax year is already published.");
  try {
    await loadTable(admin, taxYearId);
  } catch (e) {
    if (e instanceof TaxTableError) throw new HrError(`This table cannot be published: ${e.message}`);
    throw e;
  }
  const { data: overlapping } = await admin
    .from("hr_tax_years")
    .select("code")
    .eq("country", year.country)
    .eq("status", "published")
    .lte("starts_on", year.ends_on)
    .gte("ends_on", year.starts_on);
  if (overlapping?.length) throw new HrError(`${overlapping[0].code} already covers part of this year. Retire it first.`);
  const { error } = await admin
    .from("hr_tax_years")
    .update({ status: "published", published_by: actor.id, published_at: new Date().toISOString() })
    .eq("id", taxYearId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "tax_year_published", entityType: "hr_tax_year", entityId: taxYearId, after: { code: year.code } });
}

export async function retireTaxYear(admin: AdminClient, actor: Actor, taxYearId: string): Promise<void> {
  const { error } = await admin.from("hr_tax_years").update({ status: "retired" }).eq("id", taxYearId).eq("status", "published");
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "tax_year_retired", entityType: "hr_tax_year", entityId: taxYearId });
}
