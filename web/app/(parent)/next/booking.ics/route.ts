import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { buildIcs } from "@/lib/email/ics";
import { readParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Add to calendar" for the live booking of the current parent session. */
export async function GET() {
  const session = await readParentSession();
  if (!session) return new Response("Not found", { status: 404 });
  const graph = await loadApplicationGraph(createAdminClient(), session.applicationId);
  if (!graph?.booking) return new Response("Not found", { status: 404 });

  const { application: app, campus, booking } = graph;
  const ics = buildIcs({
    uid: booking.id,
    summary:
      booking.kind === "assessment"
        ? `${app.child_first_name} — Hibiscus assessment`
        : `Hibiscus Schools visit — ${campus.name}`,
    description: `Reference ${app.reference}`,
    location: [campus.name, booking.session.location].filter(Boolean).join(", "),
    startsAt: new Date(booking.session.starts_at),
    endsAt: new Date(booking.session.ends_at),
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hibiscus-booking.ics"',
      "Cache-Control": "no-store",
    },
  });
}
