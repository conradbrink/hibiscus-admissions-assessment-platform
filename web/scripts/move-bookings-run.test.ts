import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { onRescheduled } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Moving every booking off a day the school has closed.
 *
 *   cd web
 *   MOVE_FROM=2026-10-02 \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * That is the dry run and needs no credentials. To move them for real:
 *
 *   MOVE_FROM=2026-10-02 MOVE_COMMIT=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * **It does nothing at all unless `MOVE_FROM` is set.** The guard is the
 * environment, not the glob: a file that silently rebooks twelve families the
 * moment somebody widens an include pattern is not a file worth having.
 *
 * Close the day *first* — add it to `school_closures` and unpublish that
 * day's sessions — then run this. In that order the seats being vacated
 * cannot be taken by a parent booking while the move is half done, and the
 * generator will not put the day back.
 *
 * The move itself is `onRescheduled` and deliberately not hand-written SQL.
 * That function already frees the seat before rebooking (naming every status
 * the live-booking index covers), re-checks campus, grade band and capacity
 * through `book_session`, links `rescheduled_to_id` so the timeline reads
 * "moved from…", and sends the right template — `interview_moved` for a
 * scholarship child, `visit_moved` or `playdate_moved` otherwise. Writing the
 * rows here instead would have got the first three wrong and sent nothing.
 */

const from = process.env.MOVE_FROM;
const commit = process.env.MOVE_COMMIT === "1";

/** Statuses that occupy a seat — the same list the partial unique index uses. */
const LIVE = ["booked", "checked_in", "in_progress"] as const;

type Candidate = { id: string; starts_at: string; capacity: number };

/**
 * Where a booking should land: the same hour on the soonest open day, else a
 * later hour that day, else the day after.
 *
 * Same hour first because a parent chose it around their working day, and a
 * family who picked 08:00 is telling us something an algorithm optimising for
 * "soonest" would throw away.
 */
function rank(candidates: Candidate[], original: string): Candidate[] {
  const hhmm = (iso: string) => iso.slice(11, 16);
  const day = (iso: string) => iso.slice(0, 10);
  const wanted = hhmm(original);
  return [...candidates].sort((a, b) => {
    if (day(a.starts_at) !== day(b.starts_at)) return a.starts_at < b.starts_at ? -1 : 1;
    const aSame = hhmm(a.starts_at) === wanted ? 0 : 1;
    const bSame = hhmm(b.starts_at) === wanted ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    return a.starts_at < b.starts_at ? -1 : 1;
  });
}

describe("move bookings off a closed day", () => {
  it("moves them", async () => {
    if (!from) {
      console.log("MOVE_FROM not set — nothing to do.");
      return;
    }

    const admin = createAdminClient();

    const { data: bookings, error } = await admin
      .from("bookings")
      .select(
        "id, kind, booked_at, application_id, sessions!inner(id, starts_at, campus_id, kind), applications!inner(id, reference, status, requires_assessment, child_first_name, child_last_name)"
      )
      .in("status", LIVE)
      .gte("sessions.starts_at", `${from}T00:00:00Z`)
      .lt("sessions.starts_at", `${from}T23:59:59Z`)
      // Earliest booker keeps their preferred hour when a slot fills.
      .order("booked_at", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = bookings ?? [];
    console.log(`\n${commit ? "MOVING" : "DRY RUN — nothing written"} — ${rows.length} live booking(s) on ${from}\n`);

    let moved = 0;
    const stuck: string[] = [];

    for (const b of rows) {
      const session = Array.isArray(b.sessions) ? b.sessions[0] : b.sessions;
      const app = Array.isArray(b.applications) ? b.applications[0] : b.applications;
      const child = `${app.child_first_name} ${app.child_last_name}`;

      // Published is the whole filter: the closed day's sittings were
      // unpublished before this ran, so they cannot be picked as a target.
      const { data: cands, error: cErr } = await admin
        .from("sessions")
        .select("id, starts_at, capacity")
        .eq("campus_id", session.campus_id)
        .eq("kind", session.kind)
        .eq("is_published", true)
        .gt("starts_at", session.starts_at)
        .order("starts_at", { ascending: true })
        .limit(30);
      if (cErr) throw new Error(cErr.message);

      let landed = false;
      for (const c of rank(cands ?? [], session.starts_at)) {
        const { count } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("session_id", c.id)
          .in("status", LIVE);
        if ((count ?? 0) >= c.capacity) continue;

        console.log(
          `  ${app.reference}  ${child}\n     ${session.starts_at.slice(0, 16).replace("T", " ")} → ${c.starts_at.slice(0, 16).replace("T", " ")}`
        );
        if (commit) {
          // Capacity is re-checked inside `book_session` under a row lock, so
          // the count above is a preference, not the guarantee. A full slot
          // raises and we fall through to the next candidate with the old
          // booking already restored.
          try {
            await onRescheduled(admin, app, { id: b.id }, c.id, SYSTEM_ACTOR);
          } catch (e) {
            console.log(`     ! ${(e as Error).message} — trying the next slot`);
            continue;
          }
        }
        moved += 1;
        landed = true;
        break;
      }
      if (!landed) stuck.push(`${app.reference} ${child} — no open slot at this campus`);
    }

    console.log(`\n${commit ? "moved" : "would move"} ${moved} of ${rows.length}`);
    if (stuck.length > 0) {
      console.log(`\nneeds a person (${stuck.length}):`);
      for (const s of stuck) console.log(`  ${s}`);
    }
    console.log("");

    expect(stuck).toEqual([]);
  }, 300_000);
});
