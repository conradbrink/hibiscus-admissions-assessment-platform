import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMonth, isMonthStart } from "@/lib/start-month";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import { letterInPlay, onStartMonthChanged } from "@/lib/workflow/reprice-actions";

/**
 * Moving children to another starting month, by hand, with their letters.
 *
 *   cd web
 *   START_MONTH_REFERENCES=HBS-2026-00306,HBS-2026-00355 START_MONTH=2026-11-01 \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts scripts/start-month-run.test.ts
 *
 * Dry run unless `START_MONTH_COMMIT=1`. It does nothing at all unless both
 * `START_MONTH_REFERENCES` and `START_MONTH` are set.
 *
 * Each child goes through `onStartMonthChanged`, the function behind Save
 * starting month on the applicant page: the term and fee year follow the
 * month, and a letter already written is re-priced — re-drafted in place
 * while it waits for approval, withdrawn and drafted again once the family
 * has it. Every new letter waits for approval; nothing is emailed from here.
 * A child whose family has accepted, or who is enrolled, is refused as the
 * button refuses them.
 *
 * Written for 22 October 2026, when three Potch children were to start in
 * November and the button refused because their letters were already
 * written.
 */

const references = (process.env.START_MONTH_REFERENCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const month = process.env.START_MONTH ?? "";
const commit = process.env.START_MONTH_COMMIT === "1";

describe("move children to another starting month", () => {
  it("moves them", async () => {
    if (!references.length || !month) {
      console.log("START_MONTH_REFERENCES and START_MONTH not set — nothing to do.");
      return;
    }
    if (!isMonthStart(month)) throw new Error(`START_MONTH must be the first of a month, like 2026-11-01: ${month}`);
    const admin = createAdminClient();

    const { data: apps, error } = await admin.from("applications").select("*").in("reference", references);
    if (error) throw new Error(error.message);
    const missing = references.filter((r) => !(apps ?? []).some((a) => a.reference === r));
    if (missing.length) throw new Error(`not found: ${missing.join(", ")}`);

    console.log(`\n${commit ? "MOVING" : "DRY RUN — nothing written"}: ${references.length} child(ren) to ${formatMonth(month)}\n`);
    const failures: string[] = [];
    for (const app of apps!) {
      const play = await letterInPlay(admin, app);
      const letter = play.letter ? `offer ${play.letter.status}` : "no open offer";
      const plan = play.withFamily ? "withdraw and redraft for approval" : play.reDraft ? "redraft in place" : "no letter to re-price";
      console.log(`  ${app.reference}  ${app.child_first_name} ${app.child_last_name}: ${app.start_month ? formatMonth(app.start_month) : "no month"} → ${formatMonth(month)}; ${letter}, application ${app.status}: ${plan}`);
      if (!commit) continue;
      try {
        await onStartMonthChanged(admin, app, month, SYSTEM_ACTOR, { mayReprice: true });
        const { data: live, error: liveErr } = await admin
          .from("offers")
          .select("id, status, start_date, fees")
          .eq("application_id", app.id)
          .in("status", ["draft", "pending_approval", "sent", "viewed"])
          .maybeSingle();
        if (liveErr) throw new Error(liveErr.message);
        const { data: after } = await admin.from("applications").select("start_month").eq("id", app.id).single();
        expect(after?.start_month).toBe(month);
        const lines = ((live?.fees as { lines?: Array<{ label: string; amount_minor: number }> } | null)?.lines ?? [])
          .map((l) => `${l.label} ${l.amount_minor / 100}`)
          .join("; ");
        console.log(`      done: ${live ? `offer ${live.id} ${live.status}, starts ${live.start_date} — ${lines}` : "no open offer"}`);
      } catch (e) {
        failures.push(`${app.reference}: ${(e as Error).message}`);
        console.log(`      FAILED: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
