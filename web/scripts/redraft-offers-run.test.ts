import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, OfferRow } from "@/lib/supabase/types";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import { onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";

/**
 * Redrafting the offers a fee change left behind, by hand.
 *
 *   cd web
 *   REDRAFT_CAMPUSES=potch,potch_south REDRAFT_YEAR=2027 REDRAFT_REASON="…" \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts scripts/redraft-offers-run.test.ts
 *
 * Dry run unless `REDRAFT_COMMIT=1`; it needs credentials either way, and
 * writes nothing without the flag. **It does nothing at all unless
 * `REDRAFT_CAMPUSES` and `REDRAFT_YEAR` are set.**
 *
 * An offer freezes its fees when it is drafted, so a fee schedule changed
 * afterwards changes no letter already drafted — that is the point of the
 * snapshot. This brings the open letters priced from those campuses' schedules
 * for that year onto the schedules as they are now, through the same
 * functions the buttons use:
 *
 * - Waiting for approval, or a draft: redrafted in place by `onOfferDrafted`,
 *   as staff applying a promotion do. No family has seen it.
 * - Sent or viewed: withdrawn by `onOfferWithdrawn`, with the reason, and
 *   drafted again with the conditions the old letter carried. The family saw
 *   the old letter; the new one is theirs once it is approved.
 * - Accepted: listed and left alone. Going back from an accepted letter is
 *   Move to stage → back to Offer, which needs a signed-in member of staff
 *   and refuses once money has been received, so it is a person's move.
 *
 * Every new letter waits for approval, whatever `offer_auto_approve` says:
 * nothing is emailed to a family from here.
 */

const campusCodes = (process.env.REDRAFT_CAMPUSES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const year = process.env.REDRAFT_YEAR ?? "";
const reason = process.env.REDRAFT_REASON?.trim() || "Fees changed; redrafted on the current fee schedule";
const commit = process.env.REDRAFT_COMMIT === "1";

type App = Pick<ApplicationRow, "id" | "reference" | "status" | "child_first_name" | "requires_assessment">;
type Line = { code: string; amount_minor: number };

function linesOf(fees: unknown): Line[] {
  const lines = (fees as { lines?: Line[] } | null)?.lines ?? [];
  return lines.map((l) => ({ code: l.code, amount_minor: Number(l.amount_minor) }));
}

function describeChange(before: Line[], after: Line[]): string {
  const was = new Map(before.map((l) => [l.code, l.amount_minor]));
  return after
    .map((l) => (was.get(l.code) === l.amount_minor ? `${l.code} ${l.amount_minor / 100}` : `${l.code} ${(was.get(l.code) ?? 0) / 100}→${l.amount_minor / 100}`))
    .join(", ");
}

describe("redraft offers after a fee change", () => {
  it("redrafts them", async () => {
    if (!campusCodes.length || !year) {
      console.log("REDRAFT_CAMPUSES and REDRAFT_YEAR not set — nothing to do.");
      return;
    }
    const admin = createAdminClient();

    const [{ data: campuses, error: campusError }, { data: years, error: yearError }] = await Promise.all([
      admin.from("campuses").select("id, code").in("code", campusCodes),
      admin.from("academic_years").select("id, label").eq("label", year),
    ]);
    if (campusError ?? yearError) throw new Error((campusError ?? yearError)!.message);
    if ((campuses ?? []).length !== campusCodes.length) throw new Error(`campus codes not all found: ${campusCodes.join(", ")}`);
    if ((years ?? []).length !== 1) throw new Error(`no single academic year labelled ${year}`);

    const { data: schedules, error: scheduleError } = await admin
      .from("fee_schedules")
      .select("id")
      .in("campus_id", campuses!.map((c) => c.id))
      .eq("academic_year_id", years![0].id);
    if (scheduleError) throw new Error(scheduleError.message);
    const scheduleIds = (schedules ?? []).map((s) => s.id);
    if (!scheduleIds.length) throw new Error("no fee schedules for those campuses and that year");

    const { data: offers, error: offerError } = await admin
      .from("offers")
      .select("*")
      .in("fee_schedule_id", scheduleIds)
      .in("status", ["draft", "pending_approval", "sent", "viewed", "accepted"]);
    if (offerError) throw new Error(offerError.message);

    const appIds = [...new Set((offers ?? []).map((o) => o.application_id))];
    const { data: apps, error: appError } = appIds.length
      ? await admin.from("applications").select("id, reference, status, child_first_name, requires_assessment").in("id", appIds)
      : { data: [] as App[], error: null };
    if (appError) throw new Error(appError.message);
    const appById = new Map((apps ?? []).map((a) => [a.id, a as App]));

    // What each schedule says now, which is what a redraft will freeze.
    const { data: current, error: lineError } = await admin.from("fee_lines").select("schedule_id, code, amount_minor").in("schedule_id", scheduleIds);
    if (lineError) throw new Error(lineError.message);
    const nowBySchedule = new Map<string, Line[]>();
    for (const l of current ?? []) nowBySchedule.set(l.schedule_id, [...(nowBySchedule.get(l.schedule_id) ?? []), { code: l.code, amount_minor: Number(l.amount_minor) }]);

    const rows = (offers ?? [])
      .map((o) => ({ offer: o as OfferRow, app: appById.get(o.application_id)! }))
      .sort((a, b) => a.offer.status.localeCompare(b.offer.status) || a.app.reference.localeCompare(b.app.reference));

    console.log(`\n${commit ? "REDRAFTING" : "DRY RUN — nothing written"}: ${rows.length} open offer(s), ${campusCodes.join(", ")}, ${year}`);
    console.log(`  reason: ${reason}\n`);

    const failures: string[] = [];
    for (const { offer, app } of rows) {
      const before = linesOf(offer.fees);
      const expected = nowBySchedule.get(offer.fee_schedule_id ?? "") ?? [];
      const plan =
        offer.status === "accepted" ? "SKIP (accepted: Move to stage → back to Offer, by a person)" : offer.status === "sent" || offer.status === "viewed" ? "withdraw and redraft" : "redraft in place";
      console.log(`  ${app.reference}  ${app.child_first_name}  offer ${offer.status}, application ${app.status}: ${plan}`);
      console.log(`      ${describeChange(before, expected)}`);
      if (!commit || offer.status === "accepted") continue;

      try {
        if (offer.status === "sent" || offer.status === "viewed") {
          await onOfferWithdrawn(admin, app, offer, reason, SYSTEM_ACTOR);
          const { data: reloaded, error } = await admin.from("applications").select("id, reference, status, child_first_name, requires_assessment").eq("id", app.id).single();
          if (error || !reloaded) throw new Error(error?.message ?? "application vanished");
          await onOfferDrafted(admin, reloaded, SYSTEM_ACTOR, { conditions: offer.conditions, autoApprove: false });
        } else {
          await onOfferDrafted(admin, app, SYSTEM_ACTOR, { autoApprove: false });
        }

        // The letter now open must carry the schedule as it is now.
        const { data: live, error } = await admin
          .from("offers")
          .select("id, status, fees, promotion_id")
          .eq("application_id", app.id)
          .in("status", ["draft", "pending_approval", "sent", "viewed"])
          .single();
        if (error || !live) throw new Error(error?.message ?? "no open offer after the redraft");
        const got = linesOf(live.fees);
        if (!live.promotion_id) {
          expect(Object.fromEntries(got.map((l) => [l.code, l.amount_minor]))).toEqual(Object.fromEntries(expected.map((l) => [l.code, l.amount_minor])));
        }
        console.log(`      done: offer ${live.id} ${live.status}`);
      } catch (e) {
        failures.push(`${app.reference}: ${(e as Error).message}`);
        console.log(`      FAILED: ${(e as Error).message}`);
      }
    }

    if (failures.length) throw new Error(`${failures.length} offer(s) not redrafted:\n${failures.join("\n")}`);
  }, 600_000);
});
