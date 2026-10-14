import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { FactRow } from "@/lib/analytics/breakdown";
import {
  describeList,
  inParallel,
  listFilename,
  listFilters,
  listQuery,
  loadListExtras,
  readDrill,
  SHEET_HEADERS,
  sheetCells,
  slices,
  toLine,
  type ListRow,
  type ListSearch,
} from "@/lib/applicant-list";
import { ApplicantListDocument } from "@/lib/documents/applicant-list-pdf";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The applicant list as an Excel workbook or a PDF report: every applicant
 * the list on screen holds, not only the page of fifty, read with the same
 * filters from the same query string (`lib/applicant-list.ts`).
 *
 * Its own permission, `applications.export`, ticked per role under Staff &
 * roles: a list of families with their email addresses is personal data
 * leaving the system, and the school decides who may take it. The rows are
 * read through the caller's own client, so campus scoping applies exactly as
 * on screen, and every download is written to the audit log.
 */

/** As many as analytics reads for a period; a list longer than this says so in the file. */
const CAP = 5000;
/**
 * A printed report stops sooner: about 80 pages, rendered in under ten
 * seconds. Past that the spreadsheet is the right file, and the PDF says so.
 */
const PDF_CAP = 1000;
/** PostgREST's default most rows per read. */
const READ = 1000;

export async function GET(request: Request) {
  const ctx = await requireStaff("applications.export");
  // The download is a way of reading the list, not a second door to it: the
  // export permission ticked on a role that cannot see applicants would
  // otherwise hand over a file of nobody that looks finished.
  if (!can(ctx.permissions, "applications.read")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const cap = format === "pdf" ? PDF_CAP : CAP;
  const sp = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "format")) as ListSearch;
  const now = new Date();
  const f = listFilters(sp, now);

  let rows: ListRow[] = [];
  let total = 0;
  let facts: FactRow[] = [];
  let cut = 0;
  let campusName: string | null = null;
  let intakeLabel: string | null = null;
  let extras: Awaited<ReturnType<typeof loadListExtras>>;
  try {
    if (f.drill) {
      const read = await readDrill(ctx.supabase, f);
      facts = read.facts;
      cut = read.cut;
      total = read.ids.length;
      const ids = read.ids.slice(0, cap);
      const parts = await inParallel(slices(ids), async (part) => {
        const { data, error } = await listQuery(ctx.supabase, f, ctx.userId).in("id", part);
        if (error) throw new Error(error.message);
        return data ?? [];
      });
      rows = parts.flat();
      // In the order analytics listed them, newest enquiry first.
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      // A page at a time in the list's own order, each page starting after the
      // last row of the one before (by time, then id) rather than at an
      // offset: an enquiry arriving mid-download would otherwise push a row
      // from one page onto the next and take it twice.
      for (;;) {
        const first = rows.length === 0;
        if (!first && rows.length >= Math.min(total, cap)) break;
        let q = listQuery(ctx.supabase, f, ctx.userId, { count: first }).limit(Math.min(READ, cap - rows.length));
        const last = rows.at(-1);
        if (last) q = q.or(`created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.gt.${last.id})`);
        const { data, error, count } = await q;
        if (error) throw new Error(error.message);
        if (first) total = count ?? 0;
        if (!data?.length) break;
        rows = rows.concat(data);
      }
    }
    // The names the description needs; read under the caller's own rights like everything else.
    const [{ data: campus }, { data: intake }] = await Promise.all([
      f.campus ? ctx.supabase.from("v_accessible_campuses").select("name").eq("id", f.campus).maybeSingle() : Promise.resolve({ data: null }),
      f.intake && !f.drill ? ctx.supabase.from("intakes").select("label").eq("id", f.intake).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    campusName = campus?.name ?? null;
    intakeLabel = intake?.label ?? null;
    extras = await loadListExtras(ctx.supabase, rows.map((r) => r.id));
  } catch (e) {
    // A failed read must not become a short file. It would look finished, be
    // sent on, and the audit log would record a download of the wrong list.
    return new Response(`The list could not be prepared: ${e instanceof Error ? e.message : String(e)}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  const lines = rows.map((r) => toLine(r, extras));
  const description = describeList(f, { campus: campusName, intake: intakeLabel, facts, cut });
  const filename = listFilename(f, format, now);
  const takenBy = ctx.profile.full_name || ctx.profile.email;

  let body: Uint8Array<ArrayBuffer>;
  if (format === "pdf") {
    const element = createElement(ApplicantListDocument, {
      logoUrl: logoUrlFor(siteUrl()),
      description,
      lines,
      total,
      generatedAt: now.toISOString(),
      generatedBy: takenBy,
    }) as unknown as ReactElement<DocumentProps>;
    body = new Uint8Array(await renderToBuffer(element));
  } else {
    const about: string[][] = [
      ["List", description],
      ["Applicants", lines.length < total ? `${total} (the first ${lines.length} are in this file; narrow the list to take the rest)` : String(total)],
      ["Taken", formatDateTime(now)],
      ["Taken by", takenBy],
    ];
    body = new Uint8Array(
      buildWorkbook([
        { name: "Applicants", headers: SHEET_HEADERS, rows: lines.map(sheetCells) },
        { name: "About this list", headers: ["", ""], rows: about },
      ])
    );
  }

  // No record, no file: a list of families leaving the system is exactly
  // what the audit log is for, so a download it could not record is refused.
  const { error: auditError } = await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "applications.exported",
    entity_type: "applications",
    after: { format, filename, rows: lines.length, total, filters: sp },
  });
  if (auditError) {
    return new Response(`The download could not be recorded, so it was not made: ${auditError.message}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  return new Response(new Blob([body]), {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
