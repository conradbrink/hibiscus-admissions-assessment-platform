import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCrmAudit } from "@/lib/crm/audit";
import { duplicatesWithinFile, mapHeaders, parseCsv, validateRow, type ImportRecord } from "@/lib/crm/csv";
import { notifyStaff } from "@/lib/crm/notifications";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";
import type { Actor } from "@/lib/workflow/engine";

type Client = SupabaseClient<Database>;

/**
 * Importing families and parents from a spreadsheet, in two steps.
 *
 * Preview: parse, judge every row, look each one up against the families
 * already here (through the caller's client, so a match they may not see is
 * not offered), and store the verdicts. Nothing is written to a family.
 *
 * Commit: for each row the person confirmed, create the family (or add the
 * parent to the family the duplicate check found, when they chose that).
 * Through `crm_create_family`, so the family code, the audit line and the
 * outbox row are the same as a family typed in at the desk.
 */
export type PreviewSummary = { importId: string; total: number; valid: number; duplicates: number; errors: number; unknownColumns: string[]; missingColumns: string[] };

export async function previewImport(
  staff: Client,
  userId: string,
  opts: { kind: "families" | "contacts"; filename: string; text: string; campusId: string | null }
): Promise<PreviewSummary> {
  const table = parseCsv(opts.text);
  const { map, unknown, missing } = mapHeaders(table.headers);
  const { data: campuses } = await staff.from("campuses").select("code");
  const campusCodes = new Set((campuses ?? []).map((c) => c.code));

  const verdicts = table.rows.map((cells) => validateRow(map, cells, campusCodes));
  const within = duplicatesWithinFile(verdicts.map((v, index) => (v.ok ? { index, record: v.record } : null)).filter((x): x is { index: number; record: ImportRecord } => x !== null));

  const { data: imp, error } = await staff
    .from("crm_imports")
    .insert({ kind: opts.kind, filename: opts.filename.slice(0, 200), campus_id: opts.campusId, created_by: userId, total_rows: table.rows.length })
    .select("id")
    .single();
  if (error || !imp) throw new Error(error?.message ?? "Could not start the import.");

  let valid = 0;
  let duplicates = 0;
  let errors = 0;
  const rows: Array<{ import_id: string; row_no: number; data: Json; status: "valid" | "duplicate" | "error"; message: string | null; duplicate_family_id: string | null }> = [];
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    if (missing.length) {
      errors += 1;
      rows.push({ import_id: imp.id, row_no: i + 1, data: { cells: table.rows[i] } as Json, status: "error", message: `The file has no ${missing.join(", ")} column.`, duplicate_family_id: null });
      continue;
    }
    if (!v.ok) {
      errors += 1;
      rows.push({ import_id: imp.id, row_no: i + 1, data: { cells: table.rows[i] } as Json, status: "error", message: v.errors.join(" "), duplicate_family_id: null });
      continue;
    }
    const inFile = within.get(i);
    if (inFile) {
      duplicates += 1;
      rows.push({ import_id: imp.id, row_no: i + 1, data: v.record as unknown as Json, status: "duplicate", message: inFile, duplicate_family_id: null });
      continue;
    }
    const { data: matches } = await staff.rpc("crm_find_duplicates", {
      p_email: v.record.email,
      p_mobile_normalised: v.record.mobile_normalised,
      p_last_name: v.record.last_name,
      p_first_name: v.record.first_name,
    });
    const match = matches?.[0];
    if (match) {
      duplicates += 1;
      rows.push({
        import_id: imp.id,
        row_no: i + 1,
        data: v.record as unknown as Json,
        status: "duplicate",
        message: `${match.reason}: ${match.contact_name} (${match.family_code}${match.campus_name ? `, ${match.campus_name}` : ""}).`,
        duplicate_family_id: match.family_id,
      });
      continue;
    }
    valid += 1;
    rows.push({ import_id: imp.id, row_no: i + 1, data: v.record as unknown as Json, status: "valid", message: v.warnings.length ? v.warnings.join(" ") : null, duplicate_family_id: null });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: rErr } = await staff.from("crm_import_rows").insert(rows.slice(i, i + 500));
    if (rErr) throw new Error(rErr.message);
  }
  await staff.from("crm_imports").update({ valid_rows: valid, duplicate_rows: duplicates, error_rows: errors }).eq("id", imp.id);
  return { importId: imp.id, total: table.rows.length, valid, duplicates, errors, unknownColumns: unknown, missingColumns: missing };
}

export type CommitResult = { imported: number; skipped: number; failed: number };

/**
 * Writes the rows the person confirmed. `useExisting` names the duplicate
 * rows they chose to attach to the family found rather than create anew;
 * `createAnyway` the duplicate rows they chose to create regardless.
 */
export async function commitImport(
  staff: Client,
  admin: AdminClient,
  actor: Actor,
  importId: string,
  choices: { useExisting: ReadonlySet<number>; createAnyway: ReadonlySet<number>; defaultCampusId: string | null }
): Promise<CommitResult> {
  const { data: imp } = await staff.from("crm_imports").select("*").eq("id", importId).maybeSingle();
  if (!imp) throw new Error("That import is no longer there.");
  if (imp.status !== "previewed") throw new Error("That import has already been finished.");
  const { data: rows } = await staff.from("crm_import_rows").select("*").eq("import_id", importId).order("row_no");
  const { data: campuses } = await staff.from("campuses").select("id, code");
  const campusByCode = new Map((campuses ?? []).map((c) => [c.code, c.id]));

  const result: CommitResult = { imported: 0, skipped: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (row.status === "error") continue;
    const record = row.data as unknown as ImportRecord;
    const campusId = (record.campus ? campusByCode.get(record.campus) : null) ?? choices.defaultCampusId ?? imp.campus_id;
    try {
      if (row.status === "duplicate") {
        if (choices.useExisting.has(row.row_no) && row.duplicate_family_id) {
          const contactId = await addContactToFamily(staff, row.duplicate_family_id, record);
          await staff.from("crm_import_rows").update({ status: "imported", family_id: row.duplicate_family_id, contact_id: contactId }).eq("id", row.id);
          result.imported += 1;
          continue;
        }
        if (!choices.createAnyway.has(row.row_no)) {
          await staff.from("crm_import_rows").update({ status: "skipped" }).eq("id", row.id);
          result.skipped += 1;
          continue;
        }
      }
      if (!campusId) throw new Error("No campus for this row and no default campus chosen.");
      if (imp.kind === "contacts") throw new Error("A contacts file needs a family to attach each row to; use the duplicate match.");
      const { data: familyId, error } = await staff.rpc("crm_create_family", {
        p_display_name: record.family_name ?? record.last_name,
        p_campus_id: campusId,
        p_first_name: record.first_name,
        p_last_name: record.last_name,
        p_email: record.email,
        p_mobile: record.mobile,
        p_mobile_normalised: record.mobile_normalised,
        p_relationship: record.relationship,
        p_lead_source: record.lead_source,
        p_preferred_channel: record.preferred_channel,
        p_preferred_language: record.language,
        p_home_address: record.address,
        p_notes: record.notes,
        p_tags: record.tags,
        p_marketing_email: record.marketing_email,
        p_marketing_whatsapp: record.marketing_whatsapp,
        p_sms: record.sms,
        p_whatsapp_opt_in: record.whatsapp_updates,
      });
      if (error) throw new Error(error.message);
      await admin.from("families").update({ source: "import" }).eq("id", familyId);
      await admin.from("contacts").update({ consent_source: record.marketing_email || record.marketing_whatsapp || record.sms ? "import" : null }).eq("family_id", familyId);
      await staff.from("crm_import_rows").update({ status: "imported", family_id: familyId }).eq("id", row.id);
      result.imported += 1;
    } catch (e) {
      await staff.from("crm_import_rows").update({ status: "error", message: e instanceof Error ? e.message : String(e) }).eq("id", row.id);
      result.failed += 1;
    }
  }
  await staff.from("crm_imports").update({ status: "committed", committed_at: new Date().toISOString(), imported_rows: result.imported, skipped_rows: result.skipped, error_rows: imp.error_rows + result.failed }).eq("id", importId);
  await recordCrmAudit(admin, actor, { action: "import.committed", entityType: "import", entityId: importId, after: { imported: result.imported, skipped: result.skipped, failed: result.failed, filename: imp.filename } });
  await notifyStaff(admin, actor.id, { kind: "import_finished", title: `Import finished: ${result.imported} imported`, body: `${result.skipped} skipped, ${result.failed} failed.`, href: `/staff/crm/import/${importId}` });
  return result;
}

/** A second parent on a family that exists. Through the staff client, so the family policy decides. */
async function addContactToFamily(staff: Client, familyId: string, r: ImportRecord): Promise<string> {
  const { data: existing } = await staff.from("contacts").select("id").eq("email_normalised", r.email_normalised).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await staff
    .from("contacts")
    .insert({
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      email_normalised: r.email_normalised,
      mobile: r.mobile,
      mobile_normalised: r.mobile_normalised,
      family_id: familyId,
      relationship: r.relationship,
      whatsapp_opt_in: r.whatsapp_updates,
      whatsapp_opt_in_at: r.whatsapp_updates ? new Date().toISOString() : null,
      whatsapp_opt_in_source: r.whatsapp_updates ? "staff" : null,
      marketing_email_consent: r.marketing_email,
      marketing_email_consent_at: r.marketing_email ? new Date().toISOString() : null,
      marketing_whatsapp_consent: r.marketing_whatsapp,
      marketing_whatsapp_consent_at: r.marketing_whatsapp ? new Date().toISOString() : null,
      sms_consent: r.sms,
      sms_consent_at: r.sms ? new Date().toISOString() : null,
      consent_source: r.marketing_email || r.marketing_whatsapp || r.sms ? "import" : null,
      notes: r.notes,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "contact insert failed");
  return data.id;
}

/** Import rows hold names and numbers; a month after the import they go. Runs from the drain. */
export async function pruneImportRows(admin: AdminClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: old } = await admin.from("crm_imports").select("id").lt("created_at", cutoff);
  if (!old?.length) return 0;
  const { count, error } = await admin.from("crm_import_rows").delete({ count: "exact" }).in("import_id", old.map((i) => i.id));
  if (error) throw new Error(error.message);
  return count ?? 0;
}
