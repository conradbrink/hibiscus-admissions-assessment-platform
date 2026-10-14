"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError, requireStaffAction } from "@/lib/staff/session";
import { pdfSubjectOf } from "@/lib/staff/page-pdf";

/** A press on the same page by the same person within this is the same copy. */
const SAME_COPY_MS = 10 * 60_000;

/**
 * Records a press of Download PDF: who, which page (with its query string,
 * which is what decides a list's contents), when. The copy itself is the
 * browser's print-to-PDF, so this is the only trace it leaves — and a page of
 * families and their details leaving the building is what the audit log is
 * for. An applicant's, their registration's or a family's own page is also
 * filed against them, so it shows on their Audit tab, as a downloaded
 * document already does.
 *
 * As with the applicant-list download, the copy is refused rather than made
 * unrecorded: the button opens the browser's dialog only on `ok`.
 */
export async function recordPagePdf(page: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let ctx;
  try {
    ctx = await requireStaffAction("pages.export_pdf");
  } catch (e) {
    return e instanceof ForbiddenError
      ? { ok: false, error: "Your account cannot download pages as PDF." }
      : { ok: false, error: "Your sign-in could not be checked. Reload the page and try again." };
  }
  if (typeof page !== "string" || !page.startsWith("/staff")) return { ok: false, error: "Only a staff page can be downloaded." };
  const path = page.slice(0, 500);
  const admin = createAdminClient();

  // Pressed again a moment later (the dialog cancelled, landscape chosen):
  // one copy, one line, so a person's history is not filled with repeats.
  const { count: recent } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "page.pdf_downloaded")
    .eq("actor_id", ctx.userId)
    .eq("after->>path", path)
    .gte("occurred_at", new Date(Date.now() - SAME_COPY_MS).toISOString());
  if (recent) return { ok: true };

  // Filed against the applicant or family only if this person can see them:
  // the address is the browser's word, and a row on somebody else's Audit tab
  // for a page never shown would be a false record.
  let { applicationId, familyId } = pdfSubjectOf(path);
  if (applicationId) {
    const { data } = await ctx.supabase.from("applications").select("id").eq("id", applicationId).maybeSingle();
    if (!data) applicationId = null;
  }
  if (familyId) {
    const { data } = await ctx.supabase.from("families").select("id").eq("id", familyId).maybeSingle();
    if (!data) familyId = null;
  }

  const { error } = await admin.from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "page.pdf_downloaded",
    entity_type: "page",
    application_id: applicationId,
    family_id: familyId,
    after: { path },
  });
  if (error) {
    console.warn("[pdf] could not record a page download", error.message);
    return { ok: false, error: "The download could not be recorded, so it was not made. Please try again." };
  }
  return { ok: true };
}
