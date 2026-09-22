import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { formatMoney } from "@/lib/money";
import { applyPromotion } from "@/lib/promotions/apply";
import { resolvePromotion } from "@/lib/promotions/load";
import { resolveFeeSchedule } from "@/lib/offers/render";
import { snapshotFees } from "@/lib/offers/snapshot";
import { awardLabelOf, isScholarshipCode, type ScholarshipFacts } from "@/lib/promotions/scholarship";
import { SIGNATURE_BRINK, SIGNATURE_BRINK_NAME, SIGNATURE_BRINK_TITLE } from "@/lib/documents/signature";

/**
 * What an application's scholarship is worth, or null if it holds none.
 *
 * The fee figure is computed the way the offer letter computes it — the same
 * `resolveFeeSchedule`, `snapshotFees` and `applyPromotion` — rather than by
 * multiplying a percentage out separately. Two routes to one figure is two
 * routes to disagreeing about it, and the invitation is the number a parent
 * reads first, months before any offer.
 */
export async function scholarshipFor(
  admin: AdminClient,
  graph: ApplicationGraph
): Promise<ScholarshipFacts | null> {
  const resolved = await resolvePromotion(admin, graph);
  const code = resolved?.promo.code ?? null;
  const award = awardLabelOf(code);
  if (!resolved || !code || !award) return null;

  const schedule = await resolveFeeSchedule(admin, {
    campusId: graph.campus.id,
    academicYearId: graph.intake.academic_year_id,
    gradeSort: graph.grade.sort_order,
  });
  if (!schedule || schedule.lines.length === 0) return { code, award, tuitionPerTerm: null };

  const priced = applyPromotion(snapshotFees(schedule.schedule, schedule.lines), resolved.promo);
  const term = priced.lines.find((l) => l.code === "tuition_term");
  return {
    code,
    award,
    tuitionPerTerm: term ? formatMoney(term.amount_minor, priced.currency) : null,
  };
}

/**
 * The scholarship code on an application, or null — a read, and only a read.
 *
 * Deliberately not `resolvePromotion`, which will *attach* a rule-based deal
 * as a side effect of being asked. Routing an enquiry is not the moment to
 * hand out a promotion nobody applied for; by the time this is called the
 * import has already recorded the award the school decided on.
 */
export async function scholarshipCodeFor(admin: AdminClient, applicationId: string): Promise<string | null> {
  const { data } = await admin
    .from("application_promotions")
    .select("promotions(code)")
    .eq("application_id", applicationId)
    .maybeSingle();
  const promo = Array.isArray(data?.promotions) ? data?.promotions[0] : data?.promotions;
  const code = promo?.code ?? null;
  return isScholarshipCode(code) ? code : null;
}

/**
 * Who signs this application's offer letter.
 *
 * The campus's own head signs an ordinary offer — `campuses.head_name` and
 * `signature_data_url`, editable by staff without a deploy, and blank on every
 * campus today so no letter is signed at all. A scholarship is the school's
 * award rather than a campus's, and the CEO signs those, so the award
 * overrides the campus.
 *
 * Kept here rather than setting the CEO on `campuses`, which would have put
 * her name on every ordinary offer letter from Block 7 and Broadhurst too —
 * a much larger change than anybody asked for.
 */
export async function signatoryFor(
  admin: AdminClient,
  applicationId: string,
  campus: { head_name: string | null; head_title: string | null; signature_data_url: string | null }
): Promise<{ name: string | null; title: string | null; imageDataUrl: string | null }> {
  if (await scholarshipCodeFor(admin, applicationId)) {
    return { name: SIGNATURE_BRINK_NAME, title: SIGNATURE_BRINK_TITLE, imageDataUrl: SIGNATURE_BRINK };
  }
  return { name: campus.head_name, title: campus.head_title, imageDataUrl: campus.signature_data_url };
}
