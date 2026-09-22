import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { formatMoney } from "@/lib/money";
import { applyPromotion } from "@/lib/promotions/apply";
import { promotionOn } from "@/lib/promotions/load";
import { WorkflowError } from "@/lib/workflow/engine";
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
 *
 * `promotionOn` rather than `resolvePromotion`, and the difference is not a
 * detail: `sendTemplatedEmail` and `sendCompanionMessage` ask this question on
 * *every* message to *every* family, and `resolvePromotion` attaches a
 * rule-based deal to any application that has none. A reminder about an
 * outstanding document would have handed out a discount nobody applied for and
 * spent a redemption doing it.
 *
 * The cheap question is asked first. Eighty families in the school hold an
 * award and thousands do not, so the common answer costs one indexed lookup
 * and the fee arithmetic is only reached by the few it is true of.
 */
export async function scholarshipFor(
  admin: AdminClient,
  graph: ApplicationGraph
): Promise<ScholarshipFacts | null> {
  const code = await scholarshipCodeFor(admin, graph.application.id);
  const award = awardLabelOf(code);
  if (!code || !award) return null;

  const resolved = await promotionOn(admin, graph.application.id);
  if (!resolved) return null;

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
 *
 * Null means "this family holds no award". It does not mean "we could not find
 * out": the error is checked and thrown, because the quiet version of that
 * failure is a scholarship child receiving the ordinary letter, signed by the
 * wrong person, with nobody alerted.
 *
 * One round trip, not `promotionOn`'s three. This is the question every
 * message send asks before deciding whether to do any scholarship work at all,
 * and the effects rows it would load are wanted only when the answer is yes.
 */
export async function scholarshipCodeFor(admin: AdminClient, applicationId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("application_promotions")
    .select("promotions(code)")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
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
