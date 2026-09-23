import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { onWithdrawn } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import { isWithdrawnReasonCode } from "@/lib/workflow/withdrawal";

/**
 * Withdrawing one application by reference, by hand.
 *
 *   cd web
 *   WITHDRAW_REF=HBS-2026-00072 WITHDRAW_REASON="…" WITHDRAW_CODE=other \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * Dry run unless `WITHDRAW_COMMIT=1`; it needs credentials either way, and
 * writes nothing without the flag. **It does nothing at all unless
 * `WITHDRAW_REF` is set.**
 *
 * `onWithdrawn` rather than an UPDATE, because withdrawing touches six tables:
 * the live booking is cancelled (which frees its seat for another family), a
 * sitting in progress is abandoned, an unaccepted offer is withdrawn, open
 * payment requests are closed, open tasks are resolved, and the whole thing is
 * recorded as an event and an audit row. A hand-written status change would
 * leave a cancelled family holding a seat and a queue of jobs whose
 * preconditions still read as true.
 *
 * The reason code is what the analytics counts, so it should be the truth.
 * Consolidating a duplicate record is not a family choosing another school,
 * and coding it that way would show up as a lost family in the funnel for
 * ever after.
 */

const ref = process.env.WITHDRAW_REF;
const commit = process.env.WITHDRAW_COMMIT === "1";
const reason = process.env.WITHDRAW_REASON ?? null;
const rawCode = process.env.WITHDRAW_CODE ?? null;

describe("withdraw one application", () => {
  it("withdraws it", async () => {
    if (!ref) {
      console.log("WITHDRAW_REF not set — nothing to do.");
      return;
    }
    const code = rawCode && isWithdrawnReasonCode(rawCode) ? rawCode : null;
    if (rawCode && !code) throw new Error(`WITHDRAW_CODE "${rawCode}" is not one of the six reason codes`);

    const admin = createAdminClient();
    const { data: app, error } = await admin
      .from("applications")
      .select("id, reference, status, child_first_name, child_last_name, campus_id")
      .eq("reference", ref)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error(`no application with reference ${ref}`);
    if (app.status === "withdrawn") {
      console.log(`${ref} is already withdrawn — nothing to do.`);
      return;
    }

    const { data: campus } = await admin.from("campuses").select("name").eq("id", app.campus_id).maybeSingle();
    const { data: live } = await admin
      .from("bookings")
      .select("id, sessions(starts_at)")
      .eq("application_id", app.id)
      .in("status", ["booked", "checked_in", "in_progress"]);

    console.log(`\n${commit ? "WITHDRAWING" : "DRY RUN — nothing written"}`);
    console.log(`  ${app.reference}  ${app.child_first_name} ${app.child_last_name}  ${campus?.name ?? "?"}`);
    console.log(`  status ${app.status} → withdrawn`);
    console.log(`  reason ${reason ?? "(none)"}  code ${code ?? "(none)"}`);
    console.log(`  live bookings to cancel: ${(live ?? []).length}\n`);

    if (commit) {
      await onWithdrawn(admin, app, reason, SYSTEM_ACTOR, code);
      const { data: after } = await admin
        .from("applications")
        .select("status, withdrawn_reason_code")
        .eq("id", app.id)
        .maybeSingle();
      console.log(`  now: ${after?.status} (${after?.withdrawn_reason_code ?? "no code"})\n`);
      expect(after?.status).toBe("withdrawn");
    }
  }, 120_000);
});
