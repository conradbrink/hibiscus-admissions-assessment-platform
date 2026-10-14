import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { FactRow } from "@/lib/analytics/breakdown";
import {
  describeList,
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
/** PostgREST's default most rows per read. */
const READ = 1000;

export async function GET(request: Request) {
  const ctx = await requireStaff("applications.export");
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const sp = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "format")) as ListSearch;
  const now = new Date();
  const f = listFilters(sp, now);

  let rows: ListRow[] = [];
  let total = 0;
  let facts: FactRow[] = [];
  let campusName: string | null = null;
  let intakeLabel: string | null = null;
  try {
    if (f.drill) {
      const read = await readDrill(ctx.supabase, f);
      facts = read.facts;
      total = read.ids.length;
      const ids = read.ids.slice(0, CAP);
      for (const part of slices(ids)) {
        const { data, error } = await listQuery(ctx.supabase, f, ctx.userId).in("id", part);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
      }
      // In the order analytics listed them, newest enquiry first.
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      // A page at a time, by the list's own order (which breaks ties by id),
      // until every applicant it counted is in hand or the cap is reached.
      for (;;) {
        const first = rows.length === 0;
        const want = first ? CAP : Math.min(total, CAP);
        if (!first && rows.length >= want) break;
        const { data, error, count } = await listQuery(ctx.supabase, f, ctx.userId, { count: first }).range(rows.length, Math.min(rows.length + READ, want) - 1);
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
  } catch (e) {
    // A failed read must not become a short file. It would look finished, be
    // sent on, and the audit log would record a download of the wrong list.
    return new Response(`The list could not be prepared: ${e instanceof Error ? e.message : String(e)}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }

  const extras = await loadListExtras(ctx.supabase, rows.map((r) => r.id));
  const lines = rows.map((r) => toLine(r, extras));
  const description = describeList(f, { campus: campusName, intake: intakeLabel, facts });
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

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "applications.exported",
    entity_type: "applications",
    after: { format, filename, rows: lines.length, total, filters: sp },
  });

  return new Response(new Blob([body]), {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
