import "server-only";
import type { ApplicationGraph } from "@/lib/applications";
import { toSchoolDateString } from "@/lib/format-date";
import { normaliseCode, pickRulePromotion, promotionMatches, type EligibilityContext, type PromotionSummary } from "@/lib/promotions/apply";
import { isStaffDiscountCode } from "@/lib/promotions/discount";
import { isScholarshipCode } from "@/lib/promotions/scholarship";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PromotionEffectRow, PromotionRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * The database half of promotions: which deal an application carries, and
 * recording the choice. The deal on an application is set once (by the
 * parent's code, by rule, or by staff) and re-used by every re-draft, so a
 * later edit to the deal cannot change a letter.
 */

export type ResolvedPromotion = { promo: PromotionSummary; source: "code" | "rule" | "staff" };

/**
 * A code that staff give and a family never types: a staff discount
 * (`DISCOUNT-5`) or a scholarship band (`SCHOLARSHIP-50`, from the roster
 * import or the Scholarship picker). Both are live promotions with codes, and
 * a live code is otherwise anybody's who types it on the enquiry form — until
 * this was checked for scholarships, `SCHOLARSHIP-50` typed by a parent was
 * 50% off tuition with both fees waived.
 */
function givenByStaffOnly(code: string): boolean {
  return isStaffDiscountCode(code) || isScholarshipCode(code);
}

function summarise(row: PromotionRow, effects: PromotionEffectRow[]): PromotionSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    letter_text: row.letter_text,
    effects: [...effects]
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ kind: e.kind, fee_code: e.fee_code, amount_minor: e.amount_minor === null ? null : Number(e.amount_minor), percent: e.percent === null ? null : Number(e.percent), label: e.label })),
  };
}

export async function loadPromotionSummary(admin: AdminClient, promotionId: string): Promise<PromotionSummary | null> {
  const [{ data: row }, { data: effects }] = await Promise.all([
    admin.from("promotions").select("*").eq("id", promotionId).maybeSingle(),
    admin.from("promotion_effects").select("*").eq("promotion_id", promotionId).order("position"),
  ]);
  return row ? summarise(row, effects ?? []) : null;
}

export async function countRedemptions(admin: AdminClient, promotionId: string): Promise<number> {
  const { count } = await admin.from("application_promotions").select("application_id", { count: "exact", head: true }).eq("promotion_id", promotionId);
  return count ?? 0;
}

function contextFor(graph: ApplicationGraph, code: string | null, redemptions: number): EligibilityContext {
  return {
    campusId: graph.application.campus_id,
    academicYearId: graph.intake.academic_year_id,
    gradeSort: graph.grade.sort_order,
    entryRoute: graph.application.entry_route,
    heardFrom: graph.application.heard_from,
    today: toSchoolDateString(new Date()),
    code,
    redemptions,
  };
}

/** Records the deal on the application. Staff choices carry who and why. */
export async function recordPromotion(
  admin: AdminClient,
  applicationId: string,
  promotionId: string,
  source: "code" | "rule" | "staff",
  by?: { staffId: string; reason: string }
): Promise<void> {
  const { error } = await admin
    .from("application_promotions")
    .upsert({ application_id: applicationId, promotion_id: promotionId, source, applied_by: by?.staffId ?? null, reason: by?.reason ?? null, applied_at: new Date().toISOString() }, { onConflict: "application_id" });
  if (error) throw new WorkflowError(error.message, "database");
}

export async function clearPromotion(admin: AdminClient, applicationId: string): Promise<void> {
  const { error } = await admin.from("application_promotions").delete().eq("application_id", applicationId);
  if (error) throw new WorkflowError(error.message, "database");
}

/**
 * The deal already recorded on an application, and nothing else.
 *
 * A read, and only a read. `resolvePromotion` below will *attach* a deal as a
 * side effect of being asked whether there is one, which is right when an
 * offer is being drafted and wrong everywhere else — asking a question should
 * not hand a family a discount. Anything that only wants to know reads this.
 *
 * The error is checked rather than discarded: a database fault that returned
 * null here would read as "this family has no deal", and the caller would go
 * on to send the ordinary letter to a scholarship child.
 */
export async function promotionOn(admin: AdminClient, applicationId: string): Promise<ResolvedPromotion | null> {
  const { data, error } = await admin.from("application_promotions").select("*").eq("application_id", applicationId).maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  if (!data) return null;
  const promo = await loadPromotionSummary(admin, data.promotion_id);
  // `promotion_id` is `references promotions(id) on delete restrict`, so a row
  // pointing at nothing cannot exist. Saying so out loud matters because the
  // alternative — returning null — would read as "no deal" to `resolvePromotion`
  // and send it off to attach a different one.
  if (!promo) throw new WorkflowError(`promotion ${data.promotion_id} is recorded on an application but missing`, "database");
  return { promo, source: data.source };
}

/**
 * The deal for this application: the one already on it, else the parent's
 * code if it qualifies, else the first rule-based deal that applies. A code
 * that does not qualify is left on the application for staff to see and
 * applies nothing.
 *
 * Writes when it lands on a code or a rule. Only call it where attaching a
 * deal is intended; `promotionOn` is the read.
 */
export async function resolvePromotion(admin: AdminClient, graph: ApplicationGraph): Promise<ResolvedPromotion | null> {
  const existing = await promotionOn(admin, graph.application.id);
  if (existing) return existing;

  const { data: candidates, error } = await admin.from("promotions").select("*").eq("is_active", true).order("created_at");
  if (error) throw new WorkflowError(error.message, "database");
  const active = candidates ?? [];
  if (active.length === 0) return null;

  const code = normaliseCode(graph.application.promo_code);
  // A staff discount or a scholarship is given by staff, never by a typed
  // code: the enquiry form refuses both, and so does this, for a code that
  // reached the application some other way.
  const byCode = code && !givenByStaffOnly(code) ? active.find((p) => p.code === code) : null;
  if (byCode) {
    const redemptions = await countRedemptions(admin, byCode.id);
    if (promotionMatches(byCode, contextFor(graph, code, redemptions)).ok) {
      const promo = await loadPromotionSummary(admin, byCode.id);
      if (promo) {
        await recordPromotion(admin, graph.application.id, byCode.id, "code");
        return { promo, source: "code" };
      }
    }
  }

  // Rule-based deals, oldest first; redemption caps are checked one by one.
  for (const p of active.filter((c) => !c.code)) {
    const redemptions = await countRedemptions(admin, p.id);
    if (!pickRulePromotion([p], contextFor(graph, code, redemptions))) continue;
    const promo = await loadPromotionSummary(admin, p.id);
    if (!promo) continue;
    await recordPromotion(admin, graph.application.id, p.id, "rule");
    return { promo, source: "rule" };
  }
  return null;
}

/**
 * Whether any live deal has a code a parent may type, so the enquiry form
 * knows to ask. A staff discount or a scholarship band does not count: the
 * form refuses those codes, and on 22 October 2026 they were the only live
 * codes, so parents were shown a box no code of theirs could work in. It comes
 * back on its own when a deal with an ordinary code is switched on.
 */
export async function codedPromotionLive(admin: AdminClient): Promise<boolean> {
  const today = toSchoolDateString(new Date());
  const { data } = await admin.from("promotions").select("id, code, starts_on, ends_on").eq("is_active", true).not("code", "is", null);
  return (data ?? []).some(
    (p) => p.code !== null && !givenByStaffOnly(p.code) && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today)
  );
}

/**
 * The deal a typed code names, when it is live today; null otherwise. Null for
 * a staff discount or a scholarship band too, which a parent is told is not
 * recognised: otherwise anybody who learned `DISCOUNT-5` could give themselves
 * 5% off, or `SCHOLARSHIP-50` half their tuition.
 */
export async function promotionForCode(admin: AdminClient, raw: string | null | undefined): Promise<PromotionRow | null> {
  const code = normaliseCode(raw);
  if (!code || givenByStaffOnly(code)) return null;
  const { data } = await admin.from("promotions").select("*").eq("code", code).eq("is_active", true).maybeSingle();
  if (!data) return null;
  const today = toSchoolDateString(new Date());
  if (data.starts_on && data.starts_on > today) return null;
  if (data.ends_on && data.ends_on < today) return null;
  return data;
}
