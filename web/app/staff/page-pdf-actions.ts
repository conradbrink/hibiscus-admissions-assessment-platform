"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffAction } from "@/lib/staff/session";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const APPLICANT_PAGE = new RegExp(`^/staff/applications/(${UUID})(?:/|$)`, "i");
const FAMILY_PAGE = new RegExp(`^/staff/crm/families/(${UUID})(?:/|$)`, "i");

/**
 * Records a press of Download PDF: who, which page, when. The copy itself is
 * the browser's print-to-PDF, so this is the only trace it leaves — and a page
 * of families and their details leaving the building is what the audit log
 * is for. An applicant's or a family's own page is also filed against them,
 * so it shows on their Audit tab.
 *
 * As with the applicant-list download, the copy is refused rather than made
 * unrecorded: the button opens the browser's dialog only on `ok`.
 */
export async function recordPagePdf(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let ctx;
  try {
    ctx = await requireStaffAction("pages.export_pdf");
  } catch {
    return { ok: false, error: "Your account cannot download pages as PDF." };
  }
  const page = typeof path === "string" && path.startsWith("/staff") ? path.slice(0, 300) : null;
  if (!page) return { ok: false, error: "Only a staff page can be downloaded." };
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "page.pdf_downloaded",
      entity_type: "page",
      application_id: APPLICANT_PAGE.exec(page)?.[1] ?? null,
      family_id: FAMILY_PAGE.exec(page)?.[1] ?? null,
      after: { path: page },
    });
  if (error) {
    console.warn("[pdf] could not record a page download", error.message);
    return { ok: false, error: "The download could not be recorded, so it was not made. Please try again." };
  }
  return { ok: true };
}
