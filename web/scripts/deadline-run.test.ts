import { describe, expect, it } from "vitest";
import { endOfSchoolDay, formatDate } from "@/lib/format-date";
import { loadOpenPaymentRequest } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OfferRow } from "@/lib/supabase/types";
import { onOfferDeadlineMoved, onPaymentDeadlineMoved } from "@/lib/workflow/deadline-actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Moving the deadline of every family holding one kind of deal, by hand.
 *
 *   cd web
 *   DEADLINE_DATE=2026-12-05 DEADLINE_PROMOTION_PREFIX=SCHOLARSHIP- DEADLINE_REASON="…" \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts scripts/deadline-run.test.ts
 *
 * Dry run unless `DEADLINE_COMMIT=1`; `DEADLINE_NOTIFY=1` also queues the
 * `deadline_moved` email to each family moved. It does nothing at all unless
 * `DEADLINE_DATE` and `DEADLINE_PROMOTION_PREFIX` are set.
 *
 * The deadline is the one the family is working to now:
 *
 * - Accepted, not yet paid: the payment request's due date
 *   (`onPaymentDeadlineMoved`, the function behind Payments → change the date).
 * - Offer with the family, or one that lapsed unanswered: the offer's closing
 *   date (`onOfferDeadlineMoved`); a lapsed one is reopened as it was.
 *
 * Anyone else — still to be decided, a letter waiting for approval, paid,
 * withdrawn — has no deadline to move and is listed as such. A payment
 * already due later than the new date is left alone unless
 * `DEADLINE_SHORTEN=1`: that is an extension somebody gave the family.
 *
 * Written for 22 October 2026, when the school moved every scholarship
 * family's deadline to 5 December 2026 and asked for each to be told.
 */

const date = process.env.DEADLINE_DATE ?? "";
const prefix = process.env.DEADLINE_PROMOTION_PREFIX ?? "";
const reason = process.env.DEADLINE_REASON?.trim() || `Deadline moved to ${date} on the school's instruction`;
const commit = process.env.DEADLINE_COMMIT === "1";
const notify = process.env.DEADLINE_NOTIFY === "1";
const shorten = process.env.DEADLINE_SHORTEN === "1";

describe("move deadlines", () => {
  it("moves them", async () => {
    if (!date || !prefix) {
      console.log("DEADLINE_DATE and DEADLINE_PROMOTION_PREFIX not set — nothing to do.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`DEADLINE_DATE must be YYYY-MM-DD: ${date}`);
    const at = endOfSchoolDay(date);
    if (at.getTime() <= Date.now()) throw new Error("DEADLINE_DATE must be in the future");
    const admin = createAdminClient();

    const { data: held, error } = await admin
      .from("application_promotions")
      .select("application_id, promotions!inner(code), applications!inner(id, reference, status, next_action, child_first_name, child_last_name)")
      .like("promotions.code", `${prefix}%`);
    if (error) throw new Error(error.message);
    const apps = (held ?? [])
      .map((h) => (Array.isArray(h.applications) ? h.applications[0] : h.applications))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .sort((a, b) => a.status.localeCompare(b.status) || a.reference.localeCompare(b.reference));

    console.log(`\n${commit ? "MOVING" : "DRY RUN — nothing written"}: ${apps.length} application(s) holding ${prefix}*, to ${formatDate(at)}${notify ? ", emailing each family moved" : ", no email"}\n`);
    const tally: Record<string, number> = {};
    const failures: string[] = [];
    for (const app of apps) {
      const who = `${app.reference}  ${app.child_first_name} ${app.child_last_name} (${app.status})`;
      try {
        if (app.status === "payment_required") {
          const request = await loadOpenPaymentRequest(admin, app.id);
          if (!request) {
            tally["payment_required, no open request"] = (tally["payment_required, no open request"] ?? 0) + 1;
            console.log(`  ${who}: no open payment request — left alone`);
            continue;
          }
          // A later date than the new one was given to this family on purpose
          // (an extension a parent asked for): moving it is taking time back.
          if (new Date(request.due_at).getTime() > at.getTime() && !shorten) {
            tally["payment due later already — left alone"] = (tally["payment due later already — left alone"] ?? 0) + 1;
            console.log(`  ${who}: payment due ${formatDate(request.due_at)}, later than ${formatDate(at)} — left alone`);
            continue;
          }
          tally["payment due date"] = (tally["payment due date"] ?? 0) + 1;
          console.log(`  ${who}: payment due ${formatDate(request.due_at)} → ${formatDate(at)}`);
          if (commit) await onPaymentDeadlineMoved(admin, app, request, at, reason, SYSTEM_ACTOR, { notify });
        } else if (app.status === "offer_sent" || app.status === "offer_expired") {
          const { data: offer, error: offerErr } = await admin
            .from("offers")
            .select("*")
            .eq("application_id", app.id)
            .in("status", app.status === "offer_sent" ? ["sent", "viewed"] : ["expired"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (offerErr) throw new Error(offerErr.message);
          if (!offer) {
            tally[`${app.status}, no offer`] = (tally[`${app.status}, no offer`] ?? 0) + 1;
            console.log(`  ${who}: no ${app.status === "offer_sent" ? "open" : "expired"} offer — left alone`);
            continue;
          }
          const kind = app.status === "offer_expired" ? "expired offer reopened" : "offer closing date";
          tally[kind] = (tally[kind] ?? 0) + 1;
          console.log(`  ${who}: ${kind} ${formatDate(offer.expires_at)} → ${formatDate(at)}`);
          if (commit) await onOfferDeadlineMoved(admin, app, offer as OfferRow, at, reason, SYSTEM_ACTOR, { notify });
        } else {
          tally[`no deadline (${app.status})`] = (tally[`no deadline (${app.status})`] ?? 0) + 1;
        }
      } catch (e) {
        failures.push(`${app.reference}: ${(e as Error).message}`);
        console.log(`      FAILED: ${(e as Error).message}`);
      }
    }
    console.log("\n  Summary:");
    for (const [k, n] of Object.entries(tally).sort()) console.log(`    ${n.toString().padStart(3)}  ${k}`);
    expect(failures).toEqual([]);
  }, 600_000);
});
