import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCrmAudit } from "@/lib/crm/audit";
import { parseCsv } from "@/lib/crm/csv";
import {
  duplicateParentsWithinFile,
  duplicateStudentsWithinFile,
  findStudentTable,
  mapStudentHeaders,
  mergeParentTables,
  validateParentRecord,
  validateStudentRow,
  type GradeMapping,
  type ParentImportRecord,
  type StudentImportRecord,
  type Table,
} from "@/lib/crm/ed-admin-import";
import type { CommitResult, PreviewSummary } from "@/lib/crm/import";
import { notifyStaff } from "@/lib/crm/notifications";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";
import type { Actor } from "@/lib/workflow/engine";
import { looksLikeWorkbook, readWorkbook } from "@/lib/xlsx-read";

type Client = SupabaseClient<Database>;

/**
 * The Ed-admin import, server side: the lookups a preview needs and the
 * writes a commit makes. The reading and judging of rows is in
 * `ed-admin-import.ts`, which is pure.
 *
 * Two files, in this order:
 *
 *  1. **Parents.** One family per family code, with its guardians as
 *     contacts. The family keeps Ed-admin's code as its own, so the child
 *     rows and the school's billing agree with it. A family already here
 *     under that code (or with a parent's email or number) is offered as a
 *     match rather than created twice.
 *  2. **Students.** One child per row, attached to the family its code
 *     names — which must be here already — at the campus and stage its
 *     Ed-admin grade name maps to. A child already on the register (by
 *     admission number, or by name and birthday in the same family) is
 *     offered as an update. Children are written under the service role,
 *     the same as enrolment does, after the uploader's own campus access has
 *     been checked; that is the one place outside `promoteToStudent` a
 *     student row is created, and the preview is the person's check.
 */

const LOOKUP_BATCH = 10;
const IN_BATCH = 200;

/** A workbook's sheets, or a CSV's one sheet, as tables with their own headers. */
export function tablesFromFile(filename: string, bytes: Buffer): Table[] {
  if (looksLikeWorkbook(bytes)) {
    return readWorkbook(bytes).map((s) => {
      const rows = s.rows.filter((r) => r.some((c) => c.trim() !== ""));
      const headers = rows.shift() ?? [];
      return { name: s.name, headers, rows };
    });
  }
  if (/\.xls$/i.test(filename)) {
    throw new Error("This is an old-style .xls file. Open it in Excel and save it as .xlsx, then upload that.");
  }
  const csv = parseCsv(bytes.toString("utf8"));
  return [{ name: filename, headers: csv.rawHeaders, rows: csv.rows }];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type FamilyHit = { id: string; family_code: string; display_name: string | null; campus_id: string | null; how: string };

/**
 * Which family here a code names. The Ed-admin reference an earlier import
 * recorded comes first, because it says outright "this is that family in
 * Ed-admin"; then our own code (a family that started here and was
 * exported under it); then the code an older contact carries. Through the
 * caller's client, so a family they may not see is not offered.
 */
async function familiesByCode(staff: Client, codes: readonly string[]): Promise<Map<string, FamilyHit>> {
  const out = new Map<string, FamilyHit>();
  const wanted = [...new Set(codes.map((c) => c.toUpperCase()))];
  for (const batch of chunks(wanted, IN_BATCH)) {
    const { data: byRef, error: e1 } = await staff.from("families").select("id, family_code, display_name, campus_id, external_ref").in("external_ref", batch).is("merged_into_id", null);
    if (e1) throw new Error(e1.message);
    for (const f of byRef ?? []) {
      const key = (f.external_ref ?? "").toUpperCase();
      if (key && !out.has(key)) out.set(key, { id: f.id, family_code: f.family_code, display_name: f.display_name, campus_id: f.campus_id, how: "its Ed-admin reference" });
    }
    const { data: byCode, error: e2 } = await staff.from("families").select("id, family_code, display_name, campus_id").in("family_code", batch).is("merged_into_id", null);
    if (e2) throw new Error(e2.message);
    for (const f of byCode ?? []) if (!out.has(f.family_code.toUpperCase())) out.set(f.family_code.toUpperCase(), { ...f, how: "the family code" });
    const left = batch.filter((c) => !out.has(c));
    if (!left.length) continue;
    const { data: contacts, error: e3 } = await staff.from("contacts").select("family_code, families!contacts_family_id_fkey(id, family_code, display_name, campus_id, merged_into_id)").in("family_code", left);
    if (e3) throw new Error(e3.message);
    for (const c of contacts ?? []) {
      const fam = Array.isArray(c.families) ? c.families[0] : c.families;
      const key = (c.family_code ?? "").toUpperCase();
      if (fam && key && !fam.merged_into_id && !out.has(key)) out.set(key, { id: fam.id, family_code: fam.family_code, display_name: fam.display_name, campus_id: fam.campus_id, how: "a parent's family code" });
    }
  }
  return out;
}

type ImportRowInsert = Database["public"]["Tables"]["crm_import_rows"]["Insert"];

async function startImport(staff: Client, userId: string, kind: "ed_admin_parents" | "ed_admin_students", filename: string, campusId: string | null, total: number): Promise<string> {
  const { data: imp, error } = await staff
    .from("crm_imports")
    .insert({ kind, filename: filename.slice(0, 200), campus_id: campusId, created_by: userId, total_rows: total })
    .select("id")
    .single();
  if (error || !imp) throw new Error(error?.message ?? "Could not start the import.");
  return imp.id;
}

async function finishPreview(staff: Client, importId: string, rows: ImportRowInsert[], counts: { valid: number; duplicates: number; errors: number }): Promise<void> {
  for (const batch of chunks(rows, 500)) {
    const { error } = await staff.from("crm_import_rows").insert(batch);
    if (error) throw new Error(error.message);
  }
  await staff.from("crm_imports").update({ valid_rows: counts.valid, duplicate_rows: counts.duplicates, error_rows: counts.errors }).eq("id", importId);
}

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

/** What a parents row stores in `crm_import_rows.data`. */
export type ParentRowData = ParentImportRecord & { matched_how?: string };

export async function previewEdAdminParents(staff: Client, userId: string, opts: { filename: string; bytes: Buffer; campusId: string | null }): Promise<PreviewSummary> {
  const tables = tablesFromFile(opts.filename, opts.bytes);
  const report = mergeParentTables(tables);
  if (!report.families.length && report.skippedSheets.length === tables.length) {
    throw new Error("No sheet in this file has a family code column. Export the Parents workbook from Ed-admin (Basic, G1 Contact, G1 Address and so on) and upload that.");
  }
  const verdicts = report.families.map(validateParentRecord);
  const within = duplicateParentsWithinFile(verdicts.flatMap((v, index) => (v.ok ? [{ index, record: v.record }] : [])));
  const known = await familiesByCode(staff, report.families.map((f) => f.code));

  const importId = await startImport(staff, userId, "ed_admin_parents", opts.filename, opts.campusId, report.families.length);
  const rows: Array<ImportRowInsert | null> = new Array(verdicts.length).fill(null);
  const counts = { valid: 0, duplicates: 0, errors: 0 };
  const candidates: number[] = [];
  verdicts.forEach((v, i) => {
    const fam = report.families[i];
    const base = { import_id: importId, row_no: i + 1 };
    if (!v.ok) {
      counts.errors += 1;
      const data = { family_code: fam.code, first_name: fam.fields.get("g1firstname") ?? fam.fields.get("g1fname") ?? "", last_name: fam.fields.get("g1lastname") ?? fam.fields.get("g1lname") ?? "", sheet: fam.firstRow.sheet, sheet_row: fam.firstRow.row };
      rows[i] = { ...base, data: data as Json, status: "error", message: v.errors.join(" "), duplicate_family_id: null };
      return;
    }
    const inFile = within.get(i);
    if (inFile) {
      counts.duplicates += 1;
      rows[i] = { ...base, data: v.record as unknown as Json, status: "duplicate", message: inFile, duplicate_family_id: null };
      return;
    }
    const hit = known.get(fam.code);
    if (hit) {
      counts.duplicates += 1;
      const data: ParentRowData = { ...v.record, matched_how: hit.how };
      rows[i] = {
        ...base,
        data: data as unknown as Json,
        status: "duplicate",
        message: `Already here by ${hit.how}: ${hit.display_name ?? hit.family_code} (${hit.family_code}). Use existing adds any missing parent to that family.${v.warnings.length ? ` ${v.warnings.join(" ")}` : ""}`,
        duplicate_family_id: hit.id,
      };
      return;
    }
    candidates.push(i);
  });

  for (const batch of chunks(candidates, LOOKUP_BATCH)) {
    const found = await Promise.all(
      batch.map(async (i) => {
        const v = verdicts[i];
        if (!v.ok) return null;
        const g = v.record.guardians[v.record.primary_index];
        const { data: matches, error } = await staff.rpc("crm_find_duplicates", {
          p_email: g.email,
          p_mobile_normalised: g.mobile_normalised,
          p_last_name: g.last_name,
          p_first_name: g.first_name,
        });
        if (error) throw new Error(error.message);
        return matches?.[0] ?? null;
      })
    );
    batch.forEach((i, k) => {
      const v = verdicts[i];
      if (!v.ok) return;
      const match = found[k];
      const base = { import_id: importId, row_no: i + 1 };
      if (match) {
        counts.duplicates += 1;
        rows[i] = {
          ...base,
          data: v.record as unknown as Json,
          status: "duplicate",
          message: `${match.reason}: ${match.contact_name} (${match.family_code}${match.campus_name ? `, ${match.campus_name}` : ""}).${v.warnings.length ? ` ${v.warnings.join(" ")}` : ""}`,
          duplicate_family_id: match.family_id,
        };
        return;
      }
      counts.valid += 1;
      rows[i] = { ...base, data: v.record as unknown as Json, status: "valid", message: v.warnings.length ? v.warnings.join(" ") : null, duplicate_family_id: null };
    });
  }
  await finishPreview(staff, importId, rows.filter((r): r is ImportRowInsert => r !== null), counts);
  const unknown = [
    ...report.skippedSheets.map((s) => `sheet "${s}" (no family code column)`),
    ...report.rowsWithoutCode.map((r) => `${r.rows} row${r.rows === 1 ? "" : "s"} on "${r.sheet}" with no family code`),
  ];
  return { importId, total: report.families.length, valid: counts.valid, duplicates: counts.duplicates, errors: counts.errors, unknownColumns: unknown, missingColumns: [] };
}

/** A guardian who is not yet a contact anywhere, added to the family. Through the staff client, so the family policy decides. */
async function ensureContact(staff: Client, familyId: string, g: ParentImportRecord["guardians"][number]): Promise<string | null> {
  if (!g.email || !g.email_normalised) return null;
  const { data: existing } = await staff.from("contacts").select("id, family_id").eq("email_normalised", g.email_normalised).maybeSingle();
  if (existing) return existing.family_id === familyId ? existing.id : null;
  const { data, error } = await staff
    .from("contacts")
    .insert({
      first_name: g.first_name,
      last_name: g.last_name,
      email: g.email,
      email_normalised: g.email_normalised,
      mobile: g.mobile,
      mobile_normalised: g.mobile_normalised,
      family_id: familyId,
      relationship: g.relationship,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "contact insert failed");
  return data.id;
}

export async function commitEdAdminParents(
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
  const campusId = choices.defaultCampusId ?? imp.campus_id;

  const result: CommitResult = { imported: 0, skipped: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (row.status === "error") continue;
    const record = row.data as unknown as ParentRowData;
    const primary = record.guardians[record.primary_index];
    try {
      if (row.status === "duplicate") {
        if (choices.useExisting.has(row.row_no) && row.duplicate_family_id) {
          let contactId: string | null = null;
          for (const g of record.guardians) {
            const id = await ensureContact(staff, row.duplicate_family_id, g);
            if (g === primary) contactId = id;
          }
          await admin.from("families").update({ external_ref: record.family_code }).eq("id", row.duplicate_family_id).is("external_ref", null);
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
      if (!campusId) throw new Error("Choose the campus these families belong to. Their children's grades will move each family to the right campus once the students file is imported.");
      if (!primary?.email) throw new Error("No guardian with an email address.");
      // "Create anyway" on a code another family already carries as its own:
      // the new family gets the next minted code, and keeps the Ed-admin code
      // as its reference so the students file still finds it (the reference
      // is looked up before our own codes, above).
      const codeTaken = row.status === "duplicate" && (record.matched_how === "the family code" || record.matched_how === "a parent's family code");
      const { data: familyId, error } = await staff.rpc("crm_create_family", {
        p_display_name: record.family_name,
        p_campus_id: campusId,
        p_first_name: primary.first_name,
        p_last_name: primary.last_name,
        p_email: primary.email,
        p_mobile: primary.mobile,
        p_mobile_normalised: primary.mobile_normalised,
        p_relationship: primary.relationship,
        p_preferred_language: record.home_language,
        p_home_address: record.address,
        p_notes: record.notes,
        p_family_code: codeTaken ? null : record.family_code,
      });
      if (error) {
        if (error.message.includes("family_code_exists")) throw new Error(`Family code ${record.family_code} is already in use here.`);
        if (error.message.includes("contact_email_exists")) throw new Error(`${primary.email} already belongs to a contact here.`);
        throw new Error(error.message);
      }
      if (codeTaken) await admin.from("families").update({ external_ref: record.family_code, source: "import" }).eq("id", familyId);
      const primaryContact = await staff.from("contacts").select("id").eq("family_id", familyId).eq("email_normalised", primary.email_normalised ?? "").maybeSingle();
      let secondaryId: string | null = null;
      for (const g of record.guardians) {
        if (g === primary) continue;
        secondaryId = secondaryId ?? (await ensureContact(staff, familyId, g));
      }
      if (secondaryId) await admin.from("families").update({ secondary_contact_id: secondaryId }).eq("id", familyId);
      await staff.from("crm_import_rows").update({ status: "imported", family_id: familyId, contact_id: primaryContact.data?.id ?? null }).eq("id", row.id);
      result.imported += 1;
    } catch (e) {
      await staff.from("crm_import_rows").update({ status: "error", message: e instanceof Error ? e.message : String(e) }).eq("id", row.id);
      result.failed += 1;
    }
  }
  await closeImport(staff, admin, actor, importId, imp.filename, imp.error_rows, result);
  return result;
}

async function closeImport(staff: Client, admin: AdminClient, actor: Actor, importId: string, filename: string, previousErrors: number, result: CommitResult): Promise<void> {
  await staff
    .from("crm_imports")
    .update({ status: "committed", committed_at: new Date().toISOString(), imported_rows: result.imported, skipped_rows: result.skipped, error_rows: previousErrors + result.failed })
    .eq("id", importId);
  await recordCrmAudit(admin, actor, { action: "import.committed", entityType: "import", entityId: importId, after: { imported: result.imported, skipped: result.skipped, failed: result.failed, filename } });
  if (actor.id) {
    await notifyStaff(admin, actor.id, { kind: "import_finished", title: `Import finished: ${result.imported} imported`, body: `${result.skipped} skipped, ${result.failed} failed.`, href: `/staff/crm/import/${importId}` });
  }
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** What a students row stores in `crm_import_rows.data`. */
export type StudentRowData = StudentImportRecord & {
  family_id: string;
  family_name: string | null;
  /** A child already on the register that this row would update. */
  existing_student_id?: string | null;
  existing_student_code?: string | null;
};

/** Ed-admin's grade names → campus and stage, from the mapping in Settings. */
async function gradeMappings(staff: Client): Promise<Map<string, GradeMapping>> {
  const { data, error } = await staff
    .from("campus_grades")
    .select("campus_id, grade_id, external_grade_code, campuses!campus_grades_campus_id_fkey(name), grades!campus_grades_grade_id_fkey(name)")
    .not("external_grade_code", "is", null);
  if (error) throw new Error(error.message);
  const out = new Map<string, GradeMapping>();
  for (const r of data ?? []) {
    if (!r.external_grade_code) continue;
    const campus = Array.isArray(r.campuses) ? r.campuses[0] : r.campuses;
    const grade = Array.isArray(r.grades) ? r.grades[0] : r.grades;
    const m: GradeMapping = { code: r.external_grade_code, campusId: r.campus_id, campusName: campus?.name ?? "", gradeId: r.grade_id, gradeName: grade?.name ?? "" };
    out.set(m.code, m);
    if (!out.has(m.code.toLowerCase())) out.set(m.code.toLowerCase(), m);
  }
  return out;
}

async function accessibleCampuses(staff: Client): Promise<Set<string>> {
  const { data, error } = await staff.from("v_accessible_campuses").select("id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((c) => c.id));
}

type StudentHit = { id: string; student_code: string; family_id: string; external_ref: string | null; legal_first_name: string; legal_last_name: string; date_of_birth: string; origin_application_id: string | null };

/** Children already on the register that these rows might be: by admission number, by the application it came from, or by name and birthday in the family. */
async function existingStudents(staff: Client, records: ReadonlyArray<{ record: StudentImportRecord; familyId: string }>): Promise<(r: { record: StudentImportRecord; familyId: string }) => StudentHit | null> {
  const familyIds = [...new Set(records.map((r) => r.familyId))];
  const admissions = [...new Set(records.map((r) => r.record.admission_number).filter((a): a is string => !!a))];
  const students: StudentHit[] = [];
  for (const batch of chunks(familyIds, IN_BATCH)) {
    const { data, error } = await staff.from("students").select("id, student_code, family_id, external_ref, legal_first_name, legal_last_name, date_of_birth, origin_application_id").in("family_id", batch);
    if (error) throw new Error(error.message);
    students.push(...(data ?? []));
  }
  const byAdmission = new Map<string, StudentHit>();
  for (const batch of chunks(admissions, IN_BATCH)) {
    const { data, error } = await staff.from("students").select("id, student_code, family_id, external_ref, legal_first_name, legal_last_name, date_of_birth, origin_application_id").in("external_ref", batch);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) if (s.external_ref) byAdmission.set(s.external_ref.toLowerCase(), s);
    // The export writes our application reference as the admission number,
    // so a child who started here and went out to Ed-admin comes back by it.
    const { data: apps, error: aErr } = await staff.from("applications").select("id, reference").in("reference", batch);
    if (aErr) throw new Error(aErr.message);
    const appIds = (apps ?? []).map((a) => a.id);
    if (appIds.length) {
      const { data: viaApp, error: vErr } = await staff.from("students").select("id, student_code, family_id, external_ref, legal_first_name, legal_last_name, date_of_birth, origin_application_id").in("origin_application_id", appIds);
      if (vErr) throw new Error(vErr.message);
      const refOf = new Map((apps ?? []).map((a) => [a.id, a.reference.toLowerCase()]));
      for (const s of viaApp ?? []) {
        const ref = s.origin_application_id ? refOf.get(s.origin_application_id) : null;
        if (ref && !byAdmission.has(ref)) byAdmission.set(ref, s);
      }
    }
  }
  const byChild = new Map<string, StudentHit>();
  for (const s of students) byChild.set(`${s.family_id}|${s.legal_first_name.toLowerCase()}|${s.legal_last_name.toLowerCase()}|${s.date_of_birth}`, s);
  return ({ record, familyId }) => {
    const a = record.admission_number ? byAdmission.get(record.admission_number.toLowerCase()) : null;
    if (a) return a;
    return byChild.get(`${familyId}|${record.first_name.toLowerCase()}|${record.last_name.toLowerCase()}|${record.date_of_birth}`) ?? null;
  };
}

export async function previewEdAdminStudents(staff: Client, userId: string, opts: { filename: string; bytes: Buffer; campusId: string | null }): Promise<PreviewSummary> {
  const tables = tablesFromFile(opts.filename, opts.bytes);
  const table = findStudentTable(tables);
  if (!table) throw new Error("No sheet in this file looks like Ed-admin's students export: it needs Family Code, First Name, Last Name, Grade and Date of Birth columns.");
  const { map, unknown, missing } = mapStudentHeaders(table.headers);
  const [grades, campuses] = await Promise.all([gradeMappings(staff), accessibleCampuses(staff)]);
  const verdicts = table.rows.map((cells) => validateStudentRow(map, cells, grades));
  const within = duplicateStudentsWithinFile(verdicts.flatMap((v, index) => (v.ok ? [{ index, record: v.record }] : [])));
  const known = await familiesByCode(staff, verdicts.flatMap((v) => (v.ok ? [v.record.family_code] : [])));
  const placed = verdicts.flatMap((v) => {
    const fam = v.ok ? known.get(v.record.family_code) : null;
    return v.ok && fam ? [{ record: v.record, familyId: fam.id }] : [];
  });
  const existing = await existingStudents(staff, placed);

  const importId = await startImport(staff, userId, "ed_admin_students", opts.filename, opts.campusId, table.rows.length);
  const rows: ImportRowInsert[] = [];
  const counts = { valid: 0, duplicates: 0, errors: 0 };
  verdicts.forEach((v, i) => {
    const base = { import_id: importId, row_no: i + 1 };
    const cells = table.rows[i];
    const errorData = (): Json => ({
      family_code: (cells[map.indexOf("familycode")] ?? "").trim(),
      first_name: (cells[map.indexOf("firstname")] ?? "").trim(),
      last_name: (cells[map.indexOf("lastname")] ?? "").trim(),
      grade_code: (cells[map.indexOf("grade")] ?? "").trim(),
    });
    if (missing.length) {
      counts.errors += 1;
      rows.push({ ...base, data: errorData(), status: "error", message: `The file has no ${missing.join(", ")} column.`, duplicate_family_id: null });
      return;
    }
    if (!v.ok) {
      counts.errors += 1;
      rows.push({ ...base, data: errorData(), status: "error", message: v.errors.join(" "), duplicate_family_id: null });
      return;
    }
    const fam = known.get(v.record.family_code);
    if (!fam) {
      counts.errors += 1;
      rows.push({ ...base, data: errorData(), status: "error", message: `No family here with code ${v.record.family_code}. Import the Parents workbook first.`, duplicate_family_id: null });
      return;
    }
    if (!campuses.has(v.record.campus_id)) {
      counts.errors += 1;
      rows.push({ ...base, data: errorData(), status: "error", message: `${v.record.grade_code} is ${v.record.grade_name} at ${v.record.campus_name}, which you do not have access to.`, duplicate_family_id: null });
      return;
    }
    const data: StudentRowData = { ...v.record, family_id: fam.id, family_name: fam.display_name ?? fam.family_code };
    const inFile = within.get(i);
    if (inFile) {
      counts.duplicates += 1;
      rows.push({ ...base, data: data as unknown as Json, status: "duplicate", message: inFile, duplicate_family_id: null });
      return;
    }
    const hit = existing({ record: v.record, familyId: fam.id });
    if (hit) {
      counts.duplicates += 1;
      data.existing_student_id = hit.id;
      data.existing_student_code = hit.student_code;
      const sameFamily = hit.family_id === fam.id;
      rows.push({
        ...base,
        data: data as unknown as Json,
        status: "duplicate",
        message: `Already on the register as ${hit.student_code} (${hit.legal_first_name} ${hit.legal_last_name})${sameFamily ? "" : ", in a different family"}. Choosing the existing child puts this row's grade, campus and details onto that child.${v.warnings.length ? ` ${v.warnings.join(" ")}` : ""}`,
        duplicate_family_id: fam.id,
      });
      return;
    }
    counts.valid += 1;
    rows.push({ ...base, data: data as unknown as Json, status: "valid", message: v.warnings.length ? v.warnings.join(" ") : null, duplicate_family_id: null });
  });
  await finishPreview(staff, importId, rows, counts);
  return { importId, total: table.rows.length, valid: counts.valid, duplicates: counts.duplicates, errors: counts.errors, unknownColumns: unknown, missingColumns: missing };
}

/** The academic year a child imported today is enrolled in: the current one, else the one running today. */
async function currentAcademicYear(admin: AdminClient): Promise<{ id: string; starts_on: string } | null> {
  const { data, error } = await admin.from("academic_years").select("id, starts_on, ends_on, is_current").order("starts_on", { ascending: false });
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);
  return (data ?? []).find((y) => y.is_current) ?? (data ?? []).find((y) => y.starts_on <= today && y.ends_on >= today) ?? null;
}

export async function commitEdAdminStudents(
  staff: Client,
  admin: AdminClient,
  actor: Actor,
  importId: string,
  choices: { useExisting: ReadonlySet<number>; createAnyway: ReadonlySet<number> }
): Promise<CommitResult> {
  const { data: imp } = await staff.from("crm_imports").select("*").eq("id", importId).maybeSingle();
  if (!imp) throw new Error("That import is no longer there.");
  if (imp.status !== "previewed") throw new Error("That import has already been finished.");
  const { data: rows } = await staff.from("crm_import_rows").select("*").eq("import_id", importId).order("row_no");
  const [campuses, year] = await Promise.all([accessibleCampuses(staff), currentAcademicYear(admin)]);

  const result: CommitResult = { imported: 0, skipped: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (row.status === "error") continue;
    const r = row.data as unknown as StudentRowData;
    try {
      if (!campuses.has(r.campus_id)) throw new Error(`No access to ${r.campus_name}.`);
      let studentId: string;
      let created = false;
      if (row.status === "duplicate") {
        if (!(choices.useExisting.has(row.row_no) && r.existing_student_id)) {
          if (!choices.createAnyway.has(row.row_no)) {
            await staff.from("crm_import_rows").update({ status: "skipped" }).eq("id", row.id);
            result.skipped += 1;
            continue;
          }
          studentId = await createStudent(admin, r);
          created = true;
        } else {
          studentId = r.existing_student_id;
          const { error } = await admin
            .from("students")
            .update({
              external_ref: r.admission_number,
              legal_first_name: r.first_name,
              legal_middle_names: r.middle_names,
              legal_last_name: r.last_name,
              preferred_name: r.preferred_name,
              gender: r.gender,
              date_of_birth: r.date_of_birth,
              nationality: r.nationality,
              country_of_birth: r.country_of_birth,
              place_of_birth: r.place_of_birth,
              home_language: r.home_language,
              identity_number: r.identity_number,
              current_campus_id: r.campus_id,
              current_grade_id: r.grade_id,
              status: r.status,
            })
            .eq("id", studentId);
          if (error) throw new Error(error.message);
        }
      } else {
        studentId = await createStudent(admin, r);
        created = true;
      }
      // A child at school is enrolled in this year at that campus and
      // stage; the trigger on `enrolments` keeps the register in step and
      // says "onboarding" until the entry date has passed. A leaver or a
      // graduate keeps the status the row gave.
      if (r.status === "active") {
        if (!year) throw new Error("No academic year is set up, so the child cannot be enrolled. Add the year under Settings first.");
        const { error } = await admin
          .from("enrolments")
          .upsert(
            { student_id: studentId, academic_year_id: year.id, campus_id: r.campus_id, grade_id: r.grade_id, status: "active", starts_on: r.date_of_entry ?? year.starts_on },
            { onConflict: "student_id,academic_year_id" }
          );
        if (error) throw new Error(error.message);
      }
      await recordCrmAudit(admin, actor, {
        action: created ? "student.imported" : "student.updated_from_import",
        entityType: "student",
        entityId: studentId,
        familyId: r.family_id,
        after: { admission_number: r.admission_number, grade: r.grade_code, campus_id: r.campus_id, status: r.status, import_id: importId },
      });
      await staff.from("crm_import_rows").update({ status: "imported", family_id: r.family_id, student_id: studentId }).eq("id", row.id);
      result.imported += 1;
    } catch (e) {
      await staff.from("crm_import_rows").update({ status: "error", message: e instanceof Error ? e.message : String(e) }).eq("id", row.id);
      result.failed += 1;
    }
  }
  await closeImport(staff, admin, actor, importId, imp.filename, imp.error_rows, result);
  return result;
}

/** A child on the register, from an Ed-admin row. The code is minted by the database, as at enrolment. */
async function createStudent(admin: AdminClient, r: StudentRowData): Promise<string> {
  const code = await admin.rpc("next_student_code");
  if (code.error) throw new Error(code.error.message);
  const { data, error } = await admin
    .from("students")
    .insert({
      family_id: r.family_id,
      student_code: code.data,
      external_ref: r.admission_number,
      legal_first_name: r.first_name,
      legal_middle_names: r.middle_names,
      legal_last_name: r.last_name,
      preferred_name: r.preferred_name,
      gender: r.gender,
      date_of_birth: r.date_of_birth,
      nationality: r.nationality,
      country_of_birth: r.country_of_birth,
      place_of_birth: r.place_of_birth,
      home_language: r.home_language,
      identity_number: r.identity_number,
      current_campus_id: r.campus_id,
      current_grade_id: r.grade_id,
      status: r.status,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "student insert failed");
  return data.id;
}
