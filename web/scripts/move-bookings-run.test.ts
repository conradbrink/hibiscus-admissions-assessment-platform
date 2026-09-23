import { describe, expect, it } from "vitest";
import { SCHOOL_TIMEZONE } from "@/lib/format-date";
import { scholarshipCodeFor } from "@/lib/promotions/scholarship-server";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { onRescheduled } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Moving every booking off a day the school has closed.
 *
 *   cd web
 *   MOVE_FROM=2026-10-02 \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx vitest run --config scripts/scholarship.vitest.config.ts
 *
 * That is the dry run. It needs the same credentials as a real run — it reads
 * `bookings` and `sessions`, and `createAdminClient` throws without them — but
 * it writes nothing. Add `MOVE_COMMIT=1` to move them for real.
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
 * The instant a school-local calendar day begins.
 *
 * `MOVE_FROM` is the date on the school's wall, and `sessions.starts_at` is
 * stored in UTC. Filtering a UTC calendar day instead would have missed the
 * first two local hours of the closed day and swept up the first two of the
 * next one — the sort of error that only shows itself on the one morning a
 * family booked at eight.
 *
 * A fixed +02:00 is exact rather than lazy: `SCHOOL_TIMEZONE` is documented as
 * one zone for every campus because Botswana and South Africa are both UTC+2
 * with no daylight saving, so there is no offset here that varies by date.
 */
function schoolDayStart(date: string, what: string): Date {
  // Checked, not trusted. Both dates that reach here are typed by a person —
  // one into the environment, one into Settings — and `new Date("09/10/2026")`
  // is an Invalid Date whose `.toISOString()` throws. Thrown here it stops the
  // run before a single booking moves; thrown where it used to be, it stopped
  // the run halfway down the list with some families moved and the rest not.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${what} must be a date as YYYY-MM-DD, not "${date}"`);
  const at = new Date(`${date}T00:00:00+02:00`);
  if (Number.isNaN(at.getTime())) throw new Error(`${what} is not a real date: "${date}"`);
  return at;
}

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
    const settings = await getSettings(admin);

    const dayStart = schoolDayStart(from, "MOVE_FROM");
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    // Read once, before anything moves. It is the same value for every family,
    // and a bad one is a reason not to start rather than a reason to stop.
    const scholarshipDeadline = new Date(
      schoolDayStart(settings.scholarshipInterviewDeadline, "the scholarship interview deadline").getTime() + 86_400_000
    );

    const { data: bookings, error } = await admin
      .from("bookings")
      .select(
        "id, kind, booked_at, application_id, sessions!inner(id, starts_at, campus_id, kind), applications!inner(id, reference, status, requires_assessment, child_first_name, child_last_name)"
      )
      .in("status", LIVE)
      .gte("sessions.starts_at", dayStart.toISOString())
      .lt("sessions.starts_at", dayEnd.toISOString())
      // Earliest booker keeps their preferred hour when a slot fills.
      .order("booked_at", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = bookings ?? [];
    console.log(
      `\n${commit ? "MOVING" : "DRY RUN — nothing written"} — ${rows.length} live booking(s) on ${from} (${SCHOOL_TIMEZONE})\n`
    );

    // A dry run writes nothing, so the seat counts below never move on their
    // own. Without this every family would be offered the same free slot and
    // the preview would promise a day that a real run could not deliver —
    // which is the one thing a preview must not do.
    const planned = new Map<string, number>();

    let moved = 0;
    const stuck: string[] = [];

    for (const b of rows) {
      const session = Array.isArray(b.sessions) ? b.sessions[0] : b.sessions;
      const app = Array.isArray(b.applications) ? b.applications[0] : b.applications;
      const child = `${app.child_first_name} ${app.child_last_name}`;

      // A scholarship interview has a deadline the ordinary booking rules know
      // nothing about: `book_session` refuses a session in the past and
      // nothing else, so without this a family at a campus with no earlier
      // sitting would be moved politely past the date their award expires.
      //
      // Asked of the award, not of `requires_assessment`. A scholarship child
      // sits no assessment — that is the point of the award — so that flag is
      // false for exactly the families the deadline binds, and true for
      // everyone it does not.
      const award = await scholarshipCodeFor(admin, app.id);
      const deadline = award ? scholarshipDeadline : null;

      let query = admin
        .from("sessions")
        .select("id, starts_at, capacity")
        .eq("campus_id", session.campus_id)
        .eq("kind", session.kind)
        .eq("is_published", true)
        .gt("starts_at", session.starts_at);
      if (deadline) query = query.lt("starts_at", deadline.toISOString());

      const { data: cands, error: cErr } = await query.order("starts_at", { ascending: true }).limit(30);
      if (cErr) throw new Error(cErr.message);

      let landed = false;
      for (const c of rank(cands ?? [], session.starts_at)) {
        const { count } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("session_id", c.id)
          .in("status", LIVE);
        const taken = (count ?? 0) + (commit ? 0 : (planned.get(c.id) ?? 0));
        if (taken >= c.capacity) continue;

        console.log(
          `  ${app.reference}  ${child}${award ? `  [${award}]` : ""}\n     ${session.starts_at.slice(0, 16).replace("T", " ")} → ${c.starts_at.slice(0, 16).replace("T", " ")}`
        );
        if (commit) {
          try {
            await onRescheduled(admin, app, { id: b.id }, c.id, SYSTEM_ACTOR);
          } catch (e) {
            // `onRescheduled` restores the old booking when `book_session`
            // refuses — but it can also fail *after* the new booking has
            // committed, and then the family is half moved. Retrying that
            // blindly books nothing (the unique index refuses) and reports a
            // reassuring "tried the next slot" over a record only a person can
            // put right. So ask the old booking which case this is.
            const { data: old } = await admin.from("bookings").select("status").eq("id", b.id).maybeSingle();
            if (old && (LIVE as readonly string[]).includes(old.status)) {
              console.log(`     ! ${(e as Error).message} — rolled back, trying the next slot`);
              continue;
            }
            stuck.push(`${app.reference} ${child} — moved but not confirmed, needs a person: ${(e as Error).message}`);
            landed = true; // recorded above; not the generic "no open slot"
            break;
          }
        }
        moved += 1;
        planned.set(c.id, (planned.get(c.id) ?? 0) + 1);
        landed = true;
        break;
      }
      if (!landed) {
        stuck.push(
          `${app.reference} ${child} — no open slot at this campus${award ? ` before the ${settings.scholarshipInterviewDeadline} deadline` : ""}`
        );
      }
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
