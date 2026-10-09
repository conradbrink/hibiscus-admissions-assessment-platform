import { timingSafeEqual } from "node:crypto";
import { drainHrJobs } from "@/lib/jobs/drain";
import { runRetention } from "@/lib/retention";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The HR app's scheduled entry point, with `Authorization: Bearer
 * $CRON_SECRET`. Called every five minutes by pg_cron (`hr_drain_tick`),
 * hourly by GitHub Actions and nightly by Vercel, so nothing waits long if
 * one of them stops. Idempotent: `hr_claim_jobs` hands each job to one worker.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const admin = createAdminClient();
  const retention = await runRetention(admin).catch((e) => {
    console.error("[hr retention] run failed", e);
    return { anonymised: -1, errors: [String(e)] };
  });
  const summary = await drainHrJobs(admin, "schedule");
  return Response.json({ ...summary, retention: retention.anonymised });
}
