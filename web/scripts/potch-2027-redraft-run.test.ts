import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";
import { getSettings } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { ApplicationRow, OfferRow } from "@/lib/supabase/types";

/**
 * Re-drafting the 2027 Potch offers that froze the old administration fee.
 *
 *   cd web
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts scripts/potch-2027-redraft-run.test.ts
 *
 * Dry run unless `REDRAFT_COMMIT=1`. It does nothing at all unless
 * `REDRAFT_POTCH_2027=1` is set, so the ordinary script run never reaches it.
 *
 * 20261013124006_potch_2027_administration_fee.sql raised the fee from R950
 * to R1,200, and an offer keeps the fees it froze when it was drafted. This
 * finds every live offer on a 2027 Potch schedule whose snapshot of the fee
 * differs from the schedule, and does what the console's Withdraw then
 * Generate offer would: `onOfferWithdrawn`, then `onOfferDrafted` with the
 * conditions the old offer carried (a withdrawn offer is no longer the live
 * one, so the draft would not find them by itself).
 *
 * Every re-drafted offer lands in the approval queue. Nothing is approved and
 * nothing is emailed: a family whose sent offer is withdrawn hears from the
 * school when staff approve the new one. Refused outright if offers
 * auto-approve, because then a re-draft would send letters.
 */

const LIVE = ["pending_approval", "sent", "viewed"] as const;
const REASON = "Administration fee for 2027 changed from R950 to R1,200";

type Line = { code?: string; amount_minor?: number };
type Row = {
  id: string;
  status: OfferRow["status"];
  conditions: string | null;
  fees: unknown;
  applications: Pick<ApplicationRow, "id" | "reference" | "status" | "child_first_name" | "requires_assessment">;
  fee_schedules: { fee_lines: Line[] };
};

/** The administration fee in a snapshot or a schedule's lines, in cents. */
function registration(lines: unknown): number | undefined {
  return ((lines ?? []) as Line[]).find((l) => l.code === "registration")?.amount_minor;
}

describe("re-draft the 2027 Potch offers", () => {
  it("re-drafts them", async () => {
    if (process.env.REDRAFT_POTCH_2027 !== "1") {
      console.log("REDRAFT_POTCH_2027 not set — nothing to do.");
      return;
    }
    const commit = process.env.REDRAFT_COMMIT === "1";
    const admin = createAdminClient();

    const settings = await getSettings(admin);
    if (settings.offerAutoApprove) throw new Error("Offers auto-approve: a re-draft would send letters. Switch it off first.");

    const { data: offers, error } = await admin
      .from("offers")
      .select("id, status, conditions, fees, applications!inner(id, reference, status, child_first_name, requires_assessment), fee_schedules!inner(id, campuses!inner(code), academic_years!inner(label), fee_lines(code, amount_minor))")
      .in("status", LIVE)
      .in("fee_schedules.campuses.code", ["potch", "potch_south"])
      .eq("fee_schedules.academic_years.label", "2027");
    if (error) throw new Error(error.message);

    // The nested !inner filters are beyond what postgrest-js can type.
    const stale = ((offers ?? []) as unknown as Row[]).filter(
      (o) => registration((o.fees as { lines?: unknown } | null)?.lines) !== registration(o.fee_schedules.fee_lines)
    );

    console.log(`\n${commit ? "RE-DRAFTING" : "DRY RUN — nothing written"}: ${stale.length} offer(s)`);
    for (const o of stale) {
      const app = o.applications;
      const frozen = registration((o.fees as { lines?: unknown } | null)?.lines);
      console.log(`  ${app.reference}  ${app.child_first_name}  offer ${o.status}, app ${app.status}, fee ${frozen}`);
    }
    if (!commit) return;

    for (const o of stale) {
      const app = o.applications;
      await onOfferWithdrawn(admin, app, o, REASON, SYSTEM_ACTOR);
      const result = await onOfferDrafted(admin, { ...app, status: "offer_draft" }, SYSTEM_ACTOR, { conditions: o.conditions });
      if (result.blocked) throw new Error(`${app.reference}: re-draft blocked, no priced schedule`);

      const { data: after, error: afterError } = await admin
        .from("offers")
        .select("status, fees")
        .eq("id", result.offerId)
        .single();
      if (afterError) throw new Error(afterError.message);
      const fee = registration((after.fees as { lines?: unknown } | null)?.lines);
      console.log(`  ${app.reference}: new offer ${after.status}, fee ${fee}`);
      expect(after.status).toBe("pending_approval");
      expect(fee).toBe(120000);
    }
  }, 300_000);
});
